import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

// Imported only by the existing isolated A1 harness with --a2; no database target is accepted here.
export async function runJobClaimIsolation(h) {
  const { sql, json, invoke, connection, waitFor, fixtureJob, memoryFixture, row, retire, functions, service, business } = h;
  let groups = 0, races = 0;
  const pass = title => console.log(`PASS A2 ${++groups}: ${title}`);
  const snapshot = () => json("SELECT coalesce(json_agg(to_jsonb(j) ORDER BY id),'[]') FROM public.job_runs j;");
  const claim = (types, limit = 100, lease = 60) => `public.claim_jobs(${types},${limit},${lease})`;
  const typed = (type, limit = 100) => claim(`ARRAY['${type}']::text[]`, limit);
  const queuedMemory = () => {
    const f = memoryFixture();
    sql(`UPDATE public.job_runs SET status='queued',attempt_count=0,locked_until=NULL WHERE id='${f.job}';`);
    return f;
  };
  const memoryClaim = () => `public.claim_memory_jobs('${business}','a1-no-provider-model','a1-isolated-lower-layer-768',1,20,60,5)`;
  const refuse = (expression, pattern = /VALIDATION_ERROR/) => {
    const before = snapshot();
    assert.throws(() => sql(`${service} SELECT ${expression};`), pattern);
    assert.deepEqual(snapshot(), before);
  };
  const parse = result => {
    assert.equal(result.code, 0, result.stderr);
    return JSON.parse(result.stdout.split(/\r?\n/).find(line => line.startsWith("{")));
  };

  const unsafe = queuedMemory();
  const oldLegacy = json(`BEGIN; ${service} SELECT json_agg(j) FROM public.claim_jobs(100,60,5) j; ROLLBACK;`);
  assert.ok(oldLegacy.some(j => j.id === unsafe.job));
  const oldTyped = json(`BEGIN; ${service} SELECT ${typed("embed_memory")}; ROLLBACK;`);
  assert.ok(oldTyped.some(j => j.id === unsafe.job));
  retire(unsafe.job);
  const over = fixtureJob("send_paid_email", "queued", 5);
  assert.equal(invoke(typed("send_paid_email")).find(j => j.id === over)?.attempt_count, 6);
  retire(over);
  console.log("REPRODUCED before A2: legacy and typed claim Memory; typed queued attempt 5 becomes attempt 6");

  const beforeFunctions = functions();
  sql(h.migrationSql);
  const afterFunctions = functions();
  assert.equal(afterFunctions.length, beforeFunctions.length);
  let changed = 0;
  for (const before of beforeFunctions) {
    const after = afterFunctions.find(f => f.id === before.id);
    assert.ok(after);
    if (before.name === "claim_jobs") {
      assert.notEqual(after.body, before.body);
      assert.deepEqual({ ...after, body: before.body }, before);
      assert.equal(after.definer, true);
      assert.deepEqual(after.config, ['search_path=""']);
      changed++;
    } else assert.deepEqual(after, before);
  }
  assert.equal(changed, 2);
  pass("12-migration chain; exactly two claim bodies changed, all owners/ACLs/signatures and A1/Memory/admission functions identical");
  if (h.afterMigration) await h.afterMigration();

  const legacyFixtures = ["expire", "reconcile", "send_paid_email", "embed_memory"].map(t => fixtureJob(t, "queued", 5));
  for (const expression of ["public.claim_jobs()", "public.claim_jobs(100,60,5)", "public.claim_jobs(NULL::integer,60,5)"]) {
    refuse(expression, /0A000[\s\S]*TYPED_JOB_CLAIM_REQUIRED/);
  }
  legacyFixtures.forEach(retire);
  pass("legacy default/explicit/null calls fail closed with no mutation, including exhausted mixed queues");

  const invalidFixtures = ["expire","reconcile","send_paid_email","embed_memory"].map(t=>fixtureJob(t,"queued",5));
  invalidFixtures.push(fixtureJob("expire","queued",0));
  const invalid = ["NULL::text[]", "ARRAY[]::text[]", "ARRAY['embed_memory']", "ARRAY['unknown']", "ARRAY[NULL]::text[]",
    "ARRAY['expire',NULL]", "ARRAY['send_paid_email','embed_memory']", "ARRAY['expire','unknown']"];
  for (const types of invalid) refuse(claim(types));
  for (const [limit, lease] of [[0,60],[101,60],["NULL",60],[1,0],[1,3601],[1,"NULL"]]) refuse(claim("ARRAY['expire']",limit,lease));
  invalidFixtures.forEach(retire);
  pass("invalid/null/empty/unknown/Memory/mixed types and invalid bounds rejected before any row mutation");

  for (const target of ["send_paid_email", "expire", "reconcile"]) {
    const m = queuedMemory();
    const jobs = ["send_paid_email", "expire", "reconcile"].map(type => ({ type, id: fixtureJob(type,"queued",0) }));
    const protectedRows = jobs.filter(j => j.type !== target).map(j => ({ id: j.id, before: row(j.id) }));
    protectedRows.push({ id: m.job, before: row(m.job) });
    const claimed = invoke(typed(target));
    assert.ok(claimed.every(j => j.job_type === target));
    const selected = jobs.find(j => j.type === target);
    const result = claimed.find(j => j.id === selected.id);
    assert.deepEqual(Object.keys(result).sort(), ["attempt_count","business_id","entity_id","id","job_type"]);
    assert.equal(result.attempt_count, 1);
    assert.equal(sql(`SELECT status='running' AND locked_until>clock_timestamp() FROM public.job_runs WHERE id='${selected.id}';`), "t");
    protectedRows.forEach(j => assert.deepEqual(row(j.id),j.before));
    assert.equal(invoke(`public.complete_job('${selected.id}',1)`), true);
    jobs.forEach(j => retire(j.id)); retire(m.job);
    pass(`${target}: exact JSON return shape, live lease/A1 ACK; other core queues and Memory snapshots unchanged`);
  }

  const multiple = ["expire","reconcile","send_paid_email"].map(t => fixtureJob(t,"queued",0));
  const multi = invoke(claim("ARRAY['expire','reconcile','send_paid_email','expire']"));
  for (const id of multiple) assert.equal(multi.filter(j => j.id === id).length, 1);
  multiple.forEach(retire);
  pass("explicit multi-type core request accepted; repeated type does not duplicate claims");

  for (const target of ["expire","reconcile","send_paid_email"]) {
    const all = [];
    for (const type of ["expire","reconcile","send_paid_email","embed_memory"]) {
      for (const status of ["queued","retryable_failed","running"]) {
        const id = fixtureJob(type,status,5,"-1 second");
        all.push({id,type,before:row(id)});
      }
    }
    const near = fixtureJob(target,"queued",4);
    assert.equal(invoke(typed(target)).find(j => j.id === near)?.attempt_count,5);
    for (const job of all) {
      if (job.type !== target) assert.deepEqual(row(job.id),job.before);
      else {
        const current = row(job.id);
        assert.equal(current.status,"dead"); assert.equal(current.attempt_count,5);
        assert.equal(current.locked_until,null); assert.ok(current.finished_at);
      }
      retire(job.id);
    }
    retire(near);
  }
  pass("scoped exhaustion in all three generic queues: queued/retry/expired running stop at 5; other queues/Memory unchanged, attempt 4 can claim 5");

  const future = fixtureJob("expire","queued",0), active = fixtureJob("expire");
  sql(`UPDATE public.job_runs SET next_run_at=clock_timestamp()+interval '1 hour' WHERE id='${future}';`);
  const futureBefore=row(future), activeBefore=row(active);
  assert.ok(!invoke(typed("expire")).some(j => [future,active].includes(j.id)));
  assert.deepEqual(row(future),futureBefore); assert.deepEqual(row(active),activeBefore);
  retire(future); retire(active);
  const reclaim = fixtureJob("reconcile","queued",0);
  assert.equal(invoke(typed("reconcile")).find(j => j.id===reclaim)?.attempt_count,1);
  sql(`UPDATE public.job_runs SET locked_until=clock_timestamp()-interval '1 second' WHERE id='${reclaim}';`);
  assert.equal(invoke(typed("reconcile")).find(j => j.id===reclaim)?.attempt_count,2);
  assert.equal(invoke(`public.complete_job('${reclaim}',1)`),false);
  assert.equal(invoke(`public.fail_job('${reclaim}',1,'STALE')`),null);
  assert.equal(invoke(`public.complete_job('${reclaim}',2)`),true);
  pass("future schedule/live lease not claimed; expiry reclaims once with monotonic attempt and A1 stale ACK fencing");

  const oldTransaction=fixtureJob("expire","queued",0);
  const admitted=json(`BEGIN; SELECT pg_sleep(2); ${service}
    SELECT json_build_object('jobs',${claim("ARRAY['expire']",100,1)});
    DO $$ BEGIN IF NOT public.complete_job('${oldTransaction}',1) THEN RAISE EXCEPTION 'TEST_CLAIM_LEASE_ALREADY_EXPIRED'; END IF; END $$;
    COMMIT;`);
  assert.ok(admitted.jobs.some(j=>j.id===oldTransaction));
  assert.equal(row(oldTransaction).status,"succeeded");
  pass("claim in a transaction older than its one-second lease still has a live PostgreSQL-clock lease for immediate A1 ACK");

  const m = queuedMemory(), beforeMemory=row(m.job);
  refuse(typed("embed_memory"));
  assert.deepEqual(row(m.job),beforeMemory);
  const claimedMemory=invoke(`(SELECT coalesce(json_agg(j),'[]') FROM ${memoryClaim()} j)`);
  assert.ok(claimedMemory.some(j=>j.id===m.job));
  for(const op of [`public.complete_job('${m.job}',1)`,`public.fail_job('${m.job}',1,'MEMORY_ERROR')`]) {
    refuse(op,/23514[\s\S]*ATOMIC_MEMORY_INDEXING_REQUIRED/);
  }
  retire(m.job);
  pass("dedicated scoped Memory claims its own job; generic Memory claim and both A1 ACK paths refuse unchanged");

  async function held(first, others) {
    const tag=`a2-${randomUUID()}`;
    const holder=connection(`BEGIN; SET LOCAL statement_timeout='20s'; SET LOCAL application_name='${tag}'; ${first} SELECT pg_sleep(4); COMMIT;`);
    await waitFor(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='${tag}' AND wait_event='PgSleep');`);
    const outcomes=await Promise.all(others.map(query=>connection(`BEGIN; SET LOCAL statement_timeout='2s'; ${query} COMMIT;`)));
    // Successful contenders completed while the first transaction still held its row locks.
    assert.equal(sql(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='${tag}' AND wait_event='PgSleep');`),"t");
    const parsed=outcomes.map(parse);
    const firstResult=parse(await holder);
    races++;
    return [firstResult,...parsed];
  }
  const single=fixtureJob("send_paid_email","queued",0);
  const same=await held(`${service} SELECT json_build_object('jobs',${typed("send_paid_email")});`,
    [`${service} SELECT json_build_object('jobs',${typed("send_paid_email")});`]);
  assert.equal(same.flatMap(v=>v.jobs).filter(j=>j.id===single).length,1);
  assert.equal(row(single).attempt_count,1); retire(single);
  pass("observed overlapping same-type sessions: SKIP LOCKED returns promptly, one active owner, attempt increments once");

  const pair=[fixtureJob("expire","queued",0),fixtureJob("expire","queued",0)];
  const distinct=await held(`${service} SELECT json_build_object('jobs',${typed("expire",1)});`,
    [`${service} SELECT json_build_object('jobs',${typed("expire",1)});`]);
  assert.deepEqual(distinct.flatMap(v=>v.jobs.map(j=>j.id)).sort(),pair.slice().sort());
  for(const id of pair) { assert.equal(row(id).attempt_count,1); retire(id); }
  pass("active generic concurrency regression: two one-job workers get distinct typed expiration claims");

  const exhausted=fixtureJob("expire","queued",5), available=fixtureJob("expire","queued",0);
  const skipped=await held(`SELECT id FROM public.job_runs WHERE id='${exhausted}' FOR UPDATE; SELECT json_build_object('locked',true);`,
    [`${service} SELECT json_build_object('jobs',${typed("expire")});`]);
  assert.ok(skipped[1].jobs.some(j=>j.id===available));
  assert.equal(row(exhausted).status,"queued");
  assert.ok(!invoke(typed("expire")).some(j=>j.id===exhausted));
  assert.equal(row(exhausted).status,"dead"); retire(available);
  pass("exhaustion sweep also SKIP LOCKED: unrelated eligible row admitted without waiting, exhausted row retired on next scan");

  const email=fixtureJob("send_paid_email","queued",0), expire=fixtureJob("expire","queued",0), mem=queuedMemory();
  const mixed=await held(`${service} SELECT json_build_object('jobs',${typed("send_paid_email")});`,[
    `${service} SELECT json_build_object('jobs',${typed("expire")});`,
    `${service} SELECT json_build_object('jobs',(SELECT coalesce(json_agg(j),'[]') FROM ${memoryClaim()} j));`,
  ]);
  for(const [index,id,type] of [[0,email,"send_paid_email"],[1,expire,"expire"],[2,mem.job,"embed_memory"]]) {
    assert.ok(mixed[index].jobs.some(j=>j.id===id));
    assert.ok(mixed[index].jobs.every(j=>j.job_type===type));
    assert.equal(row(id).attempt_count,1); retire(id);
  }
  pass("email, expiration and dedicated Memory sessions overlap; all own only their declared queue");

  for (const role of ["anon","authenticated"]) {
    for(const expression of [typed("expire"),"public.claim_jobs(1,60,5)",`(SELECT count(*) FROM ${memoryClaim()})`]) {
      const before=snapshot();
      assert.throws(()=>sql(`SET ROLE ${role}; SELECT ${expression};`),/42501[\s\S]*permission denied/);
      assert.deepEqual(snapshot(),before);
    }
  }
  assert.equal(sql(`SELECT bool_and(NOT has_function_privilege('anon',p.oid,'EXECUTE') AND NOT has_function_privilege('authenticated',p.oid,'EXECUTE') AND has_function_privilege('service_role',p.oid,'EXECUTE'))
    FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname IN ('claim_jobs','claim_memory_jobs');`),"t");
  pass("real anon/authenticated denials; service-only original EXECUTE ACL preserved for all claim overloads");

  // Focused F05/F06 SQL regressions reuse the deployed RPC, never the persistent test fixture.
  const key=randomUUID(), winner=randomUUID(), other=randomUUID();
  const hashes=Array.from({length:3},()=>randomUUID().replaceAll("-","").repeat(2));
  const admission=(id,request=key,type="memory")=>`public.admit_ai_generation('${business}','11111111-1111-4111-8111-111111111111',
    '${id}','${type}','${request}','${"a".repeat(64)}','a2-no-provider','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4',
    NULL,NULL,NULL,NULL,'${hashes[0]}','${hashes[1]}','${hashes[2]}',1)`;
  const tag=`a2-admission-${randomUUID()}`;
  const first=connection(`BEGIN; SET LOCAL statement_timeout='20s'; SET LOCAL application_name='${tag}-a'; ${service}
    SELECT json_build_object('admission',${admission(winner)}); SELECT pg_sleep(3); COMMIT;`);
  await waitFor(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='${tag}-a' AND wait_event='PgSleep');`);
  const second=connection(`BEGIN; SET LOCAL statement_timeout='20s'; SET LOCAL application_name='${tag}-b'; ${service}
    SELECT json_build_object('admission',${admission(other)}); COMMIT;`);
  await waitFor(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='${tag}-b' AND wait_event_type='Lock');`);
  const duplicate=(await Promise.all([first,second])).map(parse);
  assert.equal(duplicate[0].admission.status,"claimed");
  assert.equal(duplicate[1].admission.status,"running");
  assert.equal(duplicate[1].admission.generationId,winner);
  assert.equal(sql(`SELECT count(*) FROM public.ai_generations WHERE business_id='${business}' AND request_key='${key}';`),"1");
  pass("F05 SQL: observed admission lock contention gives one durable Memory-generation identity, duplicate replays without a new claim");
  const bucketState=()=>json(`SELECT json_agg(to_jsonb(b) ORDER BY bucket_key_hash) FROM public.rate_limit_buckets b
    WHERE bucket_key_hash IN (${hashes.map(v=>`'${v}'`).join(",")});`);
  const charged=bucketState();
  assert.equal(charged.length,3); assert.ok(charged.every(b=>b.count===1));
  const deniedKey=randomUUID();
  assert.equal(invoke(admission(randomUUID(),deniedKey,"evaluation")).status,"denied");
  assert.deepEqual(bucketState(),charged);
  assert.equal(sql(`SELECT count(*) FROM public.ai_generations WHERE business_id='${business}' AND request_key='${deniedKey}';`),"0");
  assert.equal(invoke(admission(other)).status,"running"); assert.deepEqual(bucketState(),charged);
  pass("F06 SQL: denial atomically rolls back new generation and all three quota charges; replay is free, no provider execution");
  console.log(`PASS A2 final: ${groups} focused groups, ${races} observed overlapping claim scenarios; A1 and Memory regressions follow`);
}
