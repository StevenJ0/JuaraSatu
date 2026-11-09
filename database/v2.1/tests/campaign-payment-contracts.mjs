import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

// Runs only through the owning networkless harness. No URL/container override or external provider.
export async function runCampaignPaymentContracts({ sql, json, connection }) {
  const business = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
  const owner = "11111111-1111-4111-8111-111111111111";
  const server = "SET ROLE service_role; SET request.jwt.claim.role='service_role';";
  const auth = `SET ROLE authenticated; SET request.jwt.claim.role='authenticated'; SET request.jwt.claim.sub='${owner}';`;
  const invoke = expression => json(`${server} SELECT ${expression};`);
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  let groups = 0, sequence = 0;
  const pass = title => console.log(`PASS T1 C8/P2-2 ${++groups}: ${title}`);
  function fixture(units = 20, price = 120000) {
    const product = randomUUID(), capacity = randomUUID(), preorder = randomUUID(), item = randomUUID();
    const slug = `t1-${preorder}`, day = 3000 + ++sequence;
    sql(`INSERT INTO public.products(id,business_id,name,sku,base_price_idr,variable_cost_idr,cost_quality)
      VALUES('${product}','${business}','T1 synthetic','${product}',${price},${Math.floor(price / 2)},'estimated');
      INSERT INTO public.production_capacity(id,business_id,product_id,fulfillment_date,total_units,intake_cutoff_at,fulfillment_window_end_at)
      VALUES('${capacity}','${business}','${product}',current_date+${day},${units},now()+interval '5 days',now()+interval '${day + 1} days');
      INSERT INTO public.preorders(id,business_id,name,slug,status,fulfillment_date,starts_at,ends_at)
      VALUES('${preorder}','${business}','T1 synthetic','${slug}','draft',current_date+${day},now()-interval '1 hour',now()+interval '4 days');
      INSERT INTO public.preorder_items(id,business_id,preorder_id,product_id,capacity_id,target_units,quota_units,base_price_snapshot_idr,product_name_snapshot,sku_snapshot)
      VALUES('${item}','${business}','${preorder}','${product}','${capacity}',1,${units},${price},'T1 synthetic','${product}');
      ${auth} SELECT public.publish_preorder('${preorder}',1);`);
    return { capacity, preorder, slug, price };
  }
  function campaign(f, bps = 1000, starts = "now()-interval '1 hour'", ends = "now()+interval '2 days'") {
    const id = randomUUID(), blueprint = randomUUID(), slug = `t1-campaign-${id}`;
    // Same lower-layer fixture seam as campaign-offer.test.ts: tests resolver/writer, not Blueprint publication.
    sql(`BEGIN; SET LOCAL session_replication_role=replica;
      INSERT INTO public.campaigns(id,business_id,preorder_id,name,slug,status,offer_type,marketing_approach,discount_bps,budget_cap_idr,
        primary_kpi,target_additional_units,starts_at,ends_at,published_at,active_blueprint_id,published_blueprint_id,
        baseline_json,baseline_calculated_at,metrics_schema_version,costs_completeness)
      VALUES('${id}','${business}','${f.preorder}','T1 resolver fixture','${slug}','published','${bps ? "percent_discount" : "normal_price"}',
        '${bps ? "limited_discount" : "scheduled_reminder"}',${bps},1000,'paid_units_in_window',1,${starts},${ends},now()-interval '1 hour',
        '${blueprint}','${blueprint}','{}',now(),1,'unreviewed'); COMMIT;`);
    return { id, slug };
  }
  const offer = f => invoke(`public.read_preorder_offer('${f.preorder}')`);
  function command(f, quantity = 1, ttl = 900, price = f.price, ref = null) {
    const hash = randomUUID().replaceAll("-", "").repeat(2), key = randomUUID();
    return { hash, expression: `public.create_preorder_order('${f.slug}',${quantity},'T1 synthetic','t1@example.invalid',NULL,'${hash}',
      '${key}','${hash}',${price},${ttl},${ref === null ? "NULL" : `'${ref}'`})` };
  }
  const counts = f => json(`SELECT json_build_array((SELECT count(*) FROM public.orders WHERE preorder_id='${f.preorder}'),
    (SELECT count(*) FROM public.capacity_reservations WHERE capacity_id='${f.capacity}'));`);
  function placed(f, quantity = 1, ttl = 900) {
    const c = command(f, quantity, ttl), order = invoke(c.expression), attempt = invoke(`public.claim_payment_attempt('${c.hash}')`);
    return { order: order.order_id, attempt, hash: c.hash, amount: f.price * quantity };
  }
  const settlement = (p, event = randomUUID()) => `public.apply_verified_payment('${p.attempt.provider_order_id}','${event}','${p.hash}',
    'settlement','${randomUUID()}',${p.amount},now())`;
  const state = p => json(`SELECT json_build_object('status',o.order_status,'reservation',r.state,'applied',p.applied_at IS NOT NULL,
    'emails',(SELECT count(*) FROM public.job_runs WHERE entity_id=o.id AND job_type='send_paid_email'))
    FROM public.orders o JOIN public.capacity_reservations r ON r.order_id=o.id JOIN public.payments p ON p.order_id=o.id WHERE o.id='${p.order}';`);
  const version = p => sql(`SELECT version FROM public.orders WHERE id='${p.order}';`);
  async function holder(p, seconds = 3.5) {
    const tag = `t1-${randomUUID()}`;
    const done = connection(`BEGIN; SET LOCAL statement_timeout='15s'; SET LOCAL application_name='${tag}';
      SELECT id FROM public.orders WHERE id='${p.order}' FOR UPDATE; SELECT pg_sleep(${seconds}); COMMIT;`);
    await wait(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='${tag}' AND wait_event='PgSleep');`);
    return { done };
  }
  async function wait(query) {
    const until = Date.now() + 10000;
    while (Date.now() < until) { if (sql(query) === "t") return; await pause(30); }
    throw Error("T1 lock barrier not observed");
  }
  function outcome(result) {
    assert.equal(result.code, 0, result.stderr);
    return JSON.parse(result.stdout.split(/\r?\n/).find(line => line.startsWith("{")));
  }

  const f = fixture();
  assert.equal(offer(f).final_unit_price_idr, 120000);
  const active = campaign(f);
  assert.equal(offer(f).final_unit_price_idr, 108000);
  assert.equal(offer(f).pricing_campaign_id, active.id);
  const organic = invoke(command(f, 2, 900, 108000).expression);
  assert.deepEqual(json(`SELECT json_build_array(total_idr,pricing_campaign_id,attribution_campaign_id) FROM public.orders WHERE id='${organic.order_id}';`), [216000, active.id, null]);
  const linkedCommand = command(f, 1, 900, 108000, active.slug), linked = invoke(linkedCommand.expression);
  assert.equal(sql(`SELECT attribution_campaign_id FROM public.orders WHERE id='${linked.order_id}';`), active.id);
  assert.equal(invoke(linkedCommand.expression).replayed, true);
  const before = counts(f);
  assert.throws(() => invoke(command(f, 1, 900, 120000).expression), /OFFER_CHANGED/);
  assert.deepEqual(counts(f), before);
  const other = fixture(), foreign = campaign(other);
  const invalid = invoke(command(f, 1, 900, 108000, foreign.slug).expression);
  assert.equal(sql(`SELECT attribution_campaign_id IS NULL FROM public.orders WHERE id='${invalid.order_id}';`), "t");
  pass("base/active quote and SQL writer agree; organic vs linked/foreign attribution; replay and stale quote rollback");

  for (const [starts, ends] of [["now()+interval '1 day'", "now()+interval '2 days'"], ["now()-interval '2 days'", "now()-interval '1 day'"]]) {
    const target = fixture(); campaign(target, 1000, starts, ends); assert.equal(offer(target).final_unit_price_idr, 120000);
  }
  const normal = fixture(); const normalCampaign = campaign(normal, 0);
  const normalOrder = invoke(command(normal, 1, 900, 120000, normalCampaign.slug).expression);
  assert.deepEqual(json(`SELECT json_build_array(pricing_campaign_id,attribution_campaign_id) FROM public.orders WHERE id='${normalOrder.order_id}';`), [null, normalCampaign.id]);
  const small = fixture(10, 101); campaign(small, 500); assert.equal(offer(small).final_unit_price_idr, 96);
  pass("future/expired/normal-price eligibility and C2 floor rounding retained");

  const closingTag = `t1-close-${randomUUID()}`;
  const closing = connection(`BEGIN; SET LOCAL application_name='${closingTag}'; SET LOCAL statement_timeout='15s';
    UPDATE public.campaigns SET status='closed',closed_at=clock_timestamp() WHERE id='${active.id}'; SELECT pg_sleep(2); COMMIT;`);
  await wait(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='${closingTag}' AND wait_event='PgSleep');`);
  const duringClose = await connection(`BEGIN; SET LOCAL statement_timeout='15s'; ${server} SELECT ${command(f, 1, 900, 108000).expression}; COMMIT;`);
  assert.equal((await closing).code, 0); assert.notEqual(duringClose.code, 0); assert.match(duringClose.stderr, /OFFER_CHANGED/);
  assert.deepEqual(counts(f), [3, 3]); assert.equal(offer(f).final_unit_price_idr, 120000);
  pass("checkout waiting on campaign close rejects stale discount without a new order/reservation");

  const normalPay = placed(fixture(2), 2);
  const paid = settlement(normalPay);
  assert.equal(invoke(paid).outcome, "applied"); assert.equal(invoke(paid).outcome, "duplicate");
  assert.deepEqual(state(normalPay), { status: "awaiting_confirmation", reservation: "allocated", applied: true, emails: 1 });
  pass("verified synthetic settlement applies once with one email job; duplicate does not allocate twice");

  for (const takeSlot of [false, true]) {
    const target = fixture(2), late = placed(target, 2, 2);
    const held = await holder(late, takeSlot ? 4.5 : 3.5);
    assert.equal(sql(`SELECT expires_at>clock_timestamp() FROM public.capacity_reservations WHERE order_id='${late.order}';`), "t");
    const settling = connection(`BEGIN; SET LOCAL statement_timeout='15s'; ${server} SELECT ${settlement(late)}; COMMIT;`);
    if (takeSlot) { await pause(2300); placed(target, 2, 900); }
    assert.equal((await held.done).code, 0);
    assert.equal(outcome(await settling).outcome, "review");
    assert.deepEqual(state(late), { status: "requires_review", reservation: "released", applied: false, emails: 0 });
    assert.equal(sql(`SELECT coalesce(sum(quantity),0) FROM public.capacity_reservations WHERE capacity_id='${target.capacity}' AND (state='allocated' OR state='held' AND expires_at>clock_timestamp());`), takeSlot ? "2" : "0");
    pass(`R1 observed order-lock wait crosses deadline, review/no email/no oversell; slot reused=${takeSlot}`);
  }

  const target = fixture(4), late = placed(target, 2, 1);
  await pause(1200); assert.equal(invoke(settlement(late)).outcome, "review");
  const fresh = placed(target, 2);
  const tag = `t1-accept-${randomUUID()}`;
  const accepting = connection(`BEGIN; SET LOCAL application_name='${tag}'; SET LOCAL statement_timeout='15s';
    SELECT id FROM public.orders WHERE id='${late.order}' FOR UPDATE; SELECT pg_sleep(1.5);
    ${auth} SELECT public.accept_late_payment('${late.order}',${version(late)},'${late.attempt.payment_id}'); COMMIT;`);
  await wait(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='${tag}' AND wait_event='PgSleep');`);
  const settled = connection(`BEGIN; SET LOCAL statement_timeout='15s'; ${server} SELECT ${settlement(fresh)}; COMMIT;`);
  const [accepted, settlementResult] = await Promise.all([accepting, settled]);
  assert.equal(accepted.code, 0, accepted.stderr); assert.equal(outcome(settlementResult).outcome, "applied");
  assert.equal(state(late).applied, true); assert.equal(state(fresh).applied, true);
  pass("R2 valid late accept and another settlement share capacity without deadlock; both applied");
  const sqlstates = [];
  for (const action of ["invalid-accept", "expire"]) {
    const pending = placed(fixture(2), 2, 1); await pause(1200);
    const tag = `t1-${randomUUID()}`;
    const operation = action === "expire"
      ? `public.expire_or_cancel_order('${pending.order}',${version(pending)},'expire',NULL,NULL)`
      : `public.accept_late_payment('${pending.order}',${version(pending)},'${pending.attempt.payment_id}')`;
    const changing = connection(`BEGIN; SET LOCAL application_name='${tag}'; SET LOCAL statement_timeout='15s';
      SELECT id FROM public.orders WHERE id='${pending.order}' FOR UPDATE; SELECT pg_sleep(1.5); ${auth} SELECT ${operation}; COMMIT;`);
    await wait(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='${tag}' AND wait_event='PgSleep');`);
    const settling = connection(`BEGIN; SET LOCAL statement_timeout='15s'; ${server} SELECT ${settlement(pending)}; COMMIT;`);
    const [changed, result] = await Promise.all([changing, settling]);
    assert.doesNotMatch(changed.stderr + result.stderr, /40P01|deadlock detected/);
    if (action === "expire") assert.equal(changed.code, 0, changed.stderr);
    else { assert.notEqual(changed.code, 0); assert.match(changed.stderr, /P0001[\s\S]*ORDER_STATE_INVALID/); sqlstates.push("P0001 ORDER_STATE_INVALID (expected)"); }
    assert.equal(outcome(result).outcome, "review");
    assert.deepEqual(state(pending), { status: "requires_review", reservation: "released", applied: false, emails: 0 });
    pass(`R2 ${action} versus settlement: no deadlock, review preserved`);
  }
  return { groups, provider: "none; verified-payment SQL fixtures only", deadlineRaces: 2, lockOrderRaces: 3, sqlstates };
}
