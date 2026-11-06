import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

export async function runConcurrency(sql, connection) {
  const business = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
  const product = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
  const preorder = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4";
  const owner = "11111111-1111-4111-8111-111111111111";
  const capacity = randomUUID();
  sql(`INSERT INTO public.production_capacity(id,business_id,product_id,fulfillment_date,total_units,intake_cutoff_at,fulfillment_window_end_at)
    VALUES('${capacity}','${business}','${product}',current_date+4,1,now()+interval '3 days',now()+interval '4 days 4 hours');`);
  const reservationRace = await Promise.all([0, 1].map((index) => {
    const order = randomUUID(); const item = randomUUID();
    return connection(`BEGIN;
      INSERT INTO public.orders(id,business_id,public_order_number,source,customer_name,fulfillment_date,payment_mode,order_status,fulfillment_status,subtotal_idr,discount_total_idr,total_idr)
      VALUES('${order}','${business}','RACE-${index}','manual','Synthetic race buyer',current_date+4,'external_manual','awaiting_confirmation','pending_confirmation',120000,0,120000);
      INSERT INTO public.order_items(id,business_id,order_id,product_id,product_name_snapshot,sku_snapshot,quantity,base_unit_price_idr,discount_bps_snapshot,discount_per_unit_idr,final_unit_price_idr,variable_cost_per_unit_idr,cost_quality_snapshot,line_total_idr)
      VALUES('${item}','${business}','${order}','${product}','Synthetic race SKU','RACE',1,120000,0,0,120000,75000,'verified',120000);
      INSERT INTO public.capacity_reservations(business_id,order_id,order_item_id,capacity_id,quantity,state,expires_at)
      VALUES('${business}','${order}','${item}','${capacity}',1,'held',now()+interval '10 minutes');
      SELECT pg_sleep(0.4); COMMIT;`);
  }));
  assert.equal(reservationRace.filter((result) => result.code === 0).length, 1, JSON.stringify(reservationRace));
  assert.match(reservationRace.find((result) => result.code !== 0).stderr, /CAPACITY_EXCEEDED/);
  assert.equal(sql(`SELECT sum(quantity) FROM public.capacity_reservations WHERE capacity_id='${capacity}';`).trim(), "1");
  console.log("PASS concurrent last-slot reservations: one commit, one rejection, no oversell");

  const session = randomUUID();
  const ownerRole = `SET ROLE authenticated; SET request.jwt.claim.role='authenticated'; SET request.jwt.claim.sub='${owner}';`;
  sql(`${ownerRole} SELECT public.create_ai_session('${business}','${preorder}','${session}',repeat('a',64));`);
  const claims = await Promise.all([0, 1].map(() => connection(`BEGIN; ${ownerRole}
    SELECT public.claim_ai_generation('${business}','${session}',1,repeat('a',64),'concurrent-key',repeat('b',64),'synthetic-model','Synthetic message');
    SELECT pg_sleep(0.4); COMMIT;`)));
  for (const result of claims) assert.equal(result.code, 0, result.stderr);
  const statuses = claims.map((result) => JSON.parse(result.stdout.split(/\r?\n/).find((line) => line.startsWith("{"))).status).sort();
  assert.deepEqual(statuses, ["claimed", "running"]);
  assert.equal(sql(`SELECT count(*) FROM public.campaign_ai_messages WHERE session_id='${session}';`).trim(), "1");
  const stale = await connection(`${ownerRole} SELECT public.claim_ai_generation('${business}','${session}',1,repeat('a',64),'different-key',repeat('c',64),'synthetic-model','New stale message');`);
  assert.notEqual(stale.code, 0); assert.match(stale.stderr, /VERSION_CONFLICT/);
  console.log("PASS concurrent AI duplicate claim: one generation/message; stale new request denied");

  sql(`INSERT INTO public.job_runs(job_type,business_id,dedupe_key,status,attempt_count,next_run_at)
    VALUES('expire','${business}','race-job-1','queued',0,now()),('expire','${business}','race-job-2','queued',0,now());`);
  const workers = await Promise.all([0, 1].map(() => connection(`BEGIN; SET ROLE service_role; SET request.jwt.claim.role='service_role';
    SELECT to_jsonb(j) FROM public.claim_jobs(1,60,5) j; SELECT pg_sleep(0.4); COMMIT;`)));
  for (const result of workers) assert.equal(result.code, 0, result.stderr);
  const jobIds = workers.map((result) => JSON.parse(result.stdout.split(/\r?\n/).find((line) => line.startsWith("{"))).id);
  assert.equal(new Set(jobIds).size, 2);
  console.log("PASS concurrent job workers: distinct SKIP LOCKED claims");
  // Keep audit history on the real local stack, but leave no live synthetic hold, generation or job lease.
  sql(`SET ROLE service_role; SET request.jwt.claim.role='service_role';
    SELECT public.fail_ai_generation('${business}','${session}',
      (SELECT id FROM public.ai_generations WHERE session_id='${session}'),2,'TEST_FINISHED','${owner}');
    SELECT public.finish_job(id,attempt_count,true) FROM public.job_runs WHERE id IN ('${jobIds.join("','")}');
    UPDATE public.capacity_reservations SET state='released',released_at=clock_timestamp(),release_reason='synthetic_test_finished' WHERE capacity_id='${capacity}';
    UPDATE public.orders SET order_status='cancelled',fulfillment_status='cancelled',cancelled_at=clock_timestamp(),cancel_reason='synthetic_test_finished'
      WHERE id IN (SELECT order_id FROM public.capacity_reservations WHERE capacity_id='${capacity}');`);
}
