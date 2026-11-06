import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
// Called only by the labelled, disposable PostgreSQL harness. Never accepts a database URL/container.
export async function runMemoryPipeline(sql,connection){
  const business="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",campaign="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6",blueprint="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa9",owner="11111111-1111-4111-8111-111111111111";
  const evaluation=randomUUID(),memory=randomUUID(),hash="7".repeat(64),model="isolated-vector-fixture-v1",profile="isolated-no-semantic-proof-768";
  const vector=JSON.stringify(Array.from({length:768},(_,i)=>i===0?1:0));
  const server="SET ROLE service_role; SET request.jwt.claim.role='service_role';";
  const user=`SET ROLE authenticated; SET request.jwt.claim.role='authenticated'; SET request.jwt.claim.sub='${owner}';`;
  const match=(m=model,p=profile,version=1)=>`public.match_campaign_memories('${business}','${vector}','${m}','${p}',${version},5,0.99)`;
  const rejected=(query,pattern)=>{assert.throws(()=>sql(query),pattern);};
  // The legacy SQL contract is tested as a lower-level fixture, explicitly synthetic and sandbox.
  // It is not a Slice7B completed source, and the application rejects it as a memory-generation source.
  sql(`${server} SELECT public.record_campaign_evaluation('${business}','${campaign}','${blueprint}','${evaluation}','final',
    '{"synthetic":true,"is_sandbox_data":true,"test_only":true,"provenance":"isolated_lower_level_rpc_fixture"}',NULL,
    '["Disposable SQL plumbing fixture; not production eligible, not a verified business result"]',clock_timestamp(),'${owner}');
    INSERT INTO public.campaign_memories(id,business_id,campaign_id,source_evaluation_id,source_blueprint_id,source_version,summary_text,lessons_json,limitations_json,content_hash,review_status,embedding_status,embedding_version)
    VALUES('${memory}','${business}','${campaign}','${evaluation}','${blueprint}',1,'ISOLATED SYNTHETIC SQL FIXTURE ONLY',
      '{"synthetic":true,"test_only":true,"production_eligible":false}', '["Not application approval E2E; no semantic relevance proof"]','${hash}','draft','queued',1);`);
  assert.equal(sql(`${user} SELECT count(*) FROM ${match()};`).trim(),"0");
  console.log("PASS isolated memory draft is not retrieved; synthetic/test-only provenance retained");
  const approve=`SELECT public.approve_campaign_memory('${business}','${memory}','${hash}','${model}','${profile}','${owner}');`;
  const jobId=sql(`${server} ${approve}`).trim();assert.match(jobId,/^[a-f0-9-]{36}$/);
  sql(`${server} ${approve}`);assert.equal(sql(`SELECT count(*) FROM public.job_runs WHERE entity_id='${memory}'`).trim(),"1");
  console.log("PASS legacy isolated SQL approval atomically queues exactly one job; this is not production-source eligibility proof");
  const claim=JSON.parse(sql(`${server} SELECT coalesce(json_agg(j),'[]') FROM public.claim_jobs(100,60,5) j;`));
  const job=claim.find((j)=>j.id===jobId);assert.equal(job.attempt_count,1);assert.equal(job.status,"running");
  sql(`${server} SELECT public.finish_job('${jobId}',1,false,'EMBEDDING_UNAVAILABLE'); UPDATE public.campaign_memories SET embedding_status='failed' WHERE id='${memory}';
    UPDATE public.job_runs SET next_run_at=clock_timestamp()-interval '1 second' WHERE id='${jobId}';`);
  assert.equal(sql(`SELECT status FROM public.job_runs WHERE id='${jobId}'`).trim(),"retryable_failed");
  console.log("PASS durable indexing failure records a safe error and remains retryable");
  const race=await Promise.all([0,1].map(()=>connection(`BEGIN;${server} SELECT coalesce(json_agg(j),'[]') FROM public.claim_jobs(1,60,5) j;SELECT pg_sleep(0.2);COMMIT;`)));
  const claimed=race.map((r)=>{assert.equal(r.code,0,r.stderr);return JSON.parse(r.stdout.split(/\r?\n/).find((line)=>line.startsWith("[")));});
  assert.deepEqual(claimed.map((v)=>v.length).sort(),[0,1]);assert.equal(claimed.flat()[0].id,jobId);assert.equal(claimed.flat()[0].attempt_count,2);
  rejected(`${server} SELECT public.finish_job('${jobId}',1,true);`,/STALE_JOB_LEASE/);
  console.log("PASS memory retry claim race: one leased owner, stale acknowledgement denied");
  const complete=(h=hash,p=profile,v=vector)=>`${server} SELECT public.complete_memory_indexing('${memory}','${h}',1,'${model}','${p}','${v}');`;
  rejected(complete(hash,profile,"[1,2,3]"),/INVALID_EMBEDDING/);rejected(complete("0".repeat(64)),/STALE_EMBEDDING_JOB/);rejected(complete(hash,"incompatible-profile"),/STALE_EMBEDDING_JOB/);
  sql(complete());sql(complete());assert.equal(sql(`SELECT embedding_status||':'||extensions.vector_dims(embedding) FROM public.campaign_memories WHERE id='${memory}'`).trim(),"ready:768");
  sql(`${server} SELECT public.finish_job('${jobId}',2,true,NULL,'${hash}');SELECT public.finish_job('${jobId}',2,true,NULL,'${hash}');`);
  assert.equal(sql(`SELECT status FROM public.job_runs WHERE id='${jobId}'`).trim(),"succeeded");
  console.log("PASS vector dimension/hash/profile validation, persisted ready state and idempotent completion");
  const rows=JSON.parse(sql(`${user} SELECT json_agg(r) FROM ${match()} r;`));assert.equal(rows.length,1);assert.equal(rows[0].memory_id,memory);assert.equal(rows[0].lessons_json.synthetic,true);
  for(const query of[match("other-model"),match(model,"other-profile"),match(model,profile,2)])assert.equal(sql(`${user} SELECT count(*) FROM ${query};`).trim(),"0");
  console.log("PASS actual pgvector retrieves compatible owned fixture and excludes other model/profile/version");
  rejected(`SET ROLE authenticated;SET request.jwt.claim.role='authenticated';SET request.jwt.claim.sub='22222222-2222-4222-8222-222222222222';SELECT count(*) FROM ${match()};`,/FORBIDDEN/);
  sql(`${server} UPDATE public.campaign_memories SET embedding_status='stale' WHERE id='${memory}';`);assert.equal(sql(`${user} SELECT count(*) FROM ${match()};`).trim(),"0");
  rejected(`${server} UPDATE public.campaign_memories SET summary_text='changed' WHERE id='${memory}';`,/APPROVED_MEMORY_IMMUTABLE/);
  console.log("PASS tenant filtering, stale exclusion and immutable approved source; disposable fixture never enters the active app");
  console.log("PASS 7 isolated Slice8 SQL groups and 1 worker claim race; synthetic lower-level plumbing only");
}
