import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

// Only the labelled disposable harness imports this module. Never accepts a remote URL.
export async function runMemoryTransactions(sql,connection){
 const business="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",foreign="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
 const owner="11111111-1111-4111-8111-111111111111",campaign="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6",blueprint="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa9";
 const model="isolated-vector-fixture-v1",profile="isolated-no-semantic-proof-768",hash="8".repeat(64);
 const vector=JSON.stringify(Array.from({length:768},(_,i)=>i===0?1:0));
 const trusted="SET request.jwt.claim.role='service_role';";
 const server="SET ROLE service_role;SET request.jwt.claim.role='service_role';";
 const user=`SET ROLE authenticated;SET request.jwt.claim.role='authenticated';SET request.jwt.claim.sub='${owner}';`;
 const reject=(q,pattern)=>assert.throws(()=>sql(q),pattern);
 const approve=f=>`SELECT private.approve_memory_and_enqueue('${business}','${f.memory}','${hash}','${model}','${profile}','${owner}');`;
 const claim=(biz=business)=>`${server} SELECT coalesce(json_agg(j),'[]') FROM public.claim_memory_jobs('${biz}','${model}','${profile}',1,1,60,3) j;`;
 function fixture(){
  const evaluation=randomUUID(),memory=randomUUID();
  sql(`${trusted} SELECT public.record_campaign_evaluation('${business}','${campaign}','${blueprint}','${evaluation}','final',
   '{"synthetic":true,"test_only":true,"is_sandbox_data":true}',NULL,'["Isolated lower-layer fixture, not production eligible"]',clock_timestamp(),'${owner}');
   INSERT INTO public.campaign_memories(id,business_id,campaign_id,source_evaluation_id,source_blueprint_id,source_version,summary_text,lessons_json,limitations_json,content_hash,review_status,embedding_status,embedding_version)
   VALUES('${memory}','${business}','${campaign}','${evaluation}','${blueprint}',1,'SYNTHETIC TEST ONLY',
   '{"test_only":true,"source":{"synthetic":true,"productionEligible":false},"ownerReview":{"decision":"reviewed","ownerUserId":"${owner}","requestId":"${randomUUID()}","reviewedAt":"2026-11-04T00:00:00Z"}}',
   '["Not approved application history; private transition plumbing only"]','${hash}','draft','queued',1);`);
  return{evaluation,memory};
 }
 function queued(){const f=fixture();const job=sql(`${trusted}${approve(f)}`).trim();assert.match(job,/^[a-f0-9-]{36}$/);return{...f,job};}
 const state=f=>sql(`SELECT m.embedding_status||':'||j.status||':'||(m.embedding IS NULL)::text FROM public.campaign_memories m JOIN public.job_runs j ON j.entity_id=m.id WHERE m.id='${f.memory}'` ).trim();
 const finish=(f,attempt=1,v=vector,code="NULL")=>`SELECT private.finish_memory_index_job('${business}','${f.job}',${attempt},'${f.memory}','${hash}',1,'${model}','${profile}',${v===null?"NULL":`'${v}'::extensions.vector`},${code},3);`;
 const activate=f=>sql(`UPDATE public.job_runs SET status='running',attempt_count=1,locked_until=clock_timestamp()+interval '60 seconds' WHERE id='${f.job}';`);
 let races=0;
 async function wait(check){const end=Date.now()+10000;while(Date.now()<end){if(check())return;await new Promise(r=>setTimeout(r,30));}throw Error("Actual PostgreSQL race barrier unavailable");}
 async function race(first,second,pattern){const name=`memory8b-${randomUUID().slice(0,8)}`;
  const a=connection(`BEGIN;SET LOCAL application_name='${name}-a';${trusted}${first}SELECT pg_sleep(3);COMMIT;`);
  await wait(()=>sql(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='${name}-a' AND wait_event='PgSleep')`).trim()==="t");
  const b=connection(`BEGIN;SET LOCAL application_name='${name}-b';${trusted}${second}COMMIT;`);
  await wait(()=>sql(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='${name}-b' AND wait_event_type='Lock')`).trim()==="t");
  const[x,y]=await Promise.all([a,b]);assert.equal(x.code,0,x.stderr);if(pattern){assert.notEqual(y.code,0);assert.match(y.stderr,pattern);}else assert.equal(y.code,0,y.stderr);races++;return[x,y];
 }

 const f=fixture();await race(approve(f),approve(f));
 assert.equal(sql(`SELECT count(*) FROM public.job_runs WHERE entity_id='${f.memory}'`).trim(),"1");
 assert.equal(sql(`SELECT count(*) FROM public.domain_events WHERE entity_id='${f.memory}' AND event_type='memory_approved'`).trim(),"1");
 reject(`${trusted}${approve(f).replace(model,"conflicting-model")}`,/PROFILE_CHANGE_REQUIRES_REVIEWED_VERSION/);
 reject(`${trusted}${approve(f).replace(hash,"0".repeat(64))}`,/MEMORY_SOURCE_CONFLICT/);
 const conflict=fixture();await race(approve(conflict),approve(conflict).replace(model,"conflicting-model"),/PROFILE_CHANGE_REQUIRES_REVIEWED_VERSION/);
 sql(`UPDATE public.campaign_memories SET embedding_status='stale' WHERE id='${conflict.memory}';`);
 console.log("PASS private approval concurrency/replay: one durable job/audit; conflicting model/hash rejected; synthetic/test provenance retained");

 const rollback=fixture();
 sql(`CREATE FUNCTION test.reject_memory_enqueue() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.entity_id='${rollback.memory}' THEN RAISE EXCEPTION 'TEST_ENQUEUE_FAILURE';END IF;RETURN NEW;END$$;
 CREATE TRIGGER test_enqueue_failure BEFORE INSERT ON public.job_runs FOR EACH ROW EXECUTE FUNCTION test.reject_memory_enqueue();`);
 try{reject(`${trusted}${approve(rollback)}`,/TEST_ENQUEUE_FAILURE/);assert.equal(sql(`SELECT review_status FROM public.campaign_memories WHERE id='${rollback.memory}'`).trim(),"draft");assert.equal(sql(`SELECT count(*) FROM public.job_runs WHERE entity_id='${rollback.memory}'`).trim(),"0");assert.equal(sql(`SELECT count(*) FROM public.domain_events WHERE entity_id='${rollback.memory}'`).trim(),"0");}
 finally{sql("DROP TRIGGER test_enqueue_failure ON public.job_runs;DROP FUNCTION test.reject_memory_enqueue();");}
 console.log("PASS enqueue failure rolls back approval and leaves zero job/audit side effects");

 // The public entry point still rejects the private, explicitly synthetic plumbing fixture.
 reject(`${server}SELECT public.approve_campaign_memory('${business}','${f.memory}','${hash}','${model}','${profile}','${owner}');`,/SYNTHETIC_MEMORY_APPROVAL_FORBIDDEN/);
 for(const role of["anon","authenticated","service_role"])assert.equal(sql(`SELECT has_function_privilege('${role}','private.approve_memory_and_enqueue(uuid,uuid,text,text,text,uuid)','EXECUTE')`).trim(),"f");
 for(const role of["anon","authenticated"])reject(`SET ROLE ${role};SELECT public.claim_memory_jobs('${business}','${model}','${profile}',1);`,/permission denied/);
 reject(`${server}SELECT public.approve_campaign_memory('${business}','${f.memory}','${hash}','${model}','${profile}','22222222-2222-4222-8222-222222222222');`,/FORBIDDEN/);
 reject(`${server}SELECT public.approve_campaign_memory('${foreign}','${f.memory}','${hash}','${model}','${profile}','22222222-2222-4222-8222-222222222222');`,/no rows/);
 console.log("PASS public approval rejects synthetic/foreign sources and private transitions have no application EXECUTE grant");

 const unrelated=randomUUID();sql(`INSERT INTO public.job_runs(id,job_type,business_id,dedupe_key,status,attempt_count,next_run_at) VALUES('${unrelated}','send_paid_email','${business}','${unrelated}','queued',0,clock_timestamp());`);
 const workers=await Promise.all([0,1].map(()=>connection(`BEGIN;${claim()}SELECT pg_sleep(0.4);COMMIT;`)));
 const claims=workers.map(r=>{assert.equal(r.code,0,r.stderr);return JSON.parse(r.stdout.split(/\r?\n/).find(l=>l.startsWith("[")));}).flat();assert.equal(claims.length,1);assert.equal(claims[0].entity_id,f.memory);assert.equal(claims[0].attempt_count,1);
 assert.equal(sql(`SELECT status||':'||attempt_count FROM public.job_runs WHERE id='${unrelated}'`).trim(),"queued:0");
 assert.deepEqual(JSON.parse(sql(claim(foreign))),[]);
 console.log("PASS memory-scoped SKIP LOCKED claim: one worker per job; unrelated/foreign jobs unchanged");

 const leased={...f,job:claims[0].id};
 sql(`UPDATE public.job_runs SET locked_until=clock_timestamp()-interval '1 second' WHERE id='${leased.job}';`);
 const reclaimed=JSON.parse(sql(claim()))[0];assert.equal(reclaimed.id,leased.job);assert.equal(reclaimed.attempt_count,2);
 reject(finish(leased,1),/STALE_JOB_LEASE/);sql(finish(leased,2));sql(finish(leased,2));assert.equal(state(leased),"ready:succeeded:false");
 reject(`${server}SELECT public.finish_job('${leased.job}',2,true);`,/ATOMIC_MEMORY_INDEXING_REQUIRED/);
 reject(`${server}SELECT public.complete_memory_indexing('${f.memory}','${hash}',1,'${model}','${profile}','${vector}');`,/permission denied/);
 console.log("PASS expired worker cannot write; reclaimed attempt atomically saves vector+ack, exact replay succeeds, old paths sealed");

 const invalid=queued();activate(invalid);
 for(const v of["[1,2,3]",JSON.stringify(Array(768).fill(0)),"[NaN]"]){reject(finish(invalid,1,v),/INVALID_EMBEDDING|NaN/);assert.equal(state(invalid),"queued:running:true");}
 reject(finish(invalid).replace(hash,"0".repeat(64)),/STALE_EMBEDDING_JOB/);
 reject(finish(invalid).replace(profile,"incompatible"),/STALE_EMBEDDING_JOB/);
 sql(`CREATE FUNCTION test.reject_memory_ack() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.id='${invalid.job}' AND NEW.status='succeeded' THEN RAISE EXCEPTION 'TEST_ACK_FAILURE';END IF;RETURN NEW;END$$;
 CREATE TRIGGER test_ack_failure BEFORE UPDATE ON public.job_runs FOR EACH ROW EXECUTE FUNCTION test.reject_memory_ack();`);
 try{reject(finish(invalid),/TEST_ACK_FAILURE/);assert.equal(state(invalid),"queued:running:true");}
 finally{sql("DROP TRIGGER test_ack_failure ON public.job_runs;DROP FUNCTION test.reject_memory_ack();");}
 sql(`BEGIN;${finish(invalid)}ROLLBACK;`);assert.equal(state(invalid),"queued:running:true");
 sql(finish(invalid));assert.equal(state(invalid),"ready:succeeded:false");
 console.log("PASS invalid vector/hash/profile and forced acknowledgement failure never partially persist vector or success");

 const stale=queued();activate(stale);await race(`UPDATE public.campaign_memories SET embedding_status='stale' WHERE id='${stale.memory}';`,finish(stale),/STALE_EMBEDDING_JOB/);
 assert.equal(state(stale),"stale:running:true");
 const duplicate=queued();activate(duplicate);await race(finish(duplicate),finish(duplicate));assert.equal(state(duplicate),"ready:succeeded:false");
 console.log("PASS actual concurrent invalidation rejects stale vector; concurrent duplicate completion has one durable result");

 const recovery=queued();activate(recovery);sql(finish(recovery));
 // Simulate an older independently committed ready result with a still-running retry; no provenance is changed.
 sql(`UPDATE public.job_runs SET status='running',locked_until=clock_timestamp()+interval '60 seconds',finished_at=NULL WHERE id='${recovery.job}';`);
 sql(finish(recovery,1,null));assert.equal(state(recovery),"ready:succeeded:false");
 const reclaimRace=queued();activate(reclaimRace);sql(`UPDATE public.job_runs SET locked_until=clock_timestamp()-interval '1 second',next_run_at='2000-01-01' WHERE id='${reclaimRace.job}';`);
 await race(claim(),finish(reclaimRace),/STALE_JOB_LEASE/);sql(finish(reclaimRace,2));assert.equal(state(reclaimRace),"ready:succeeded:false");
 console.log("PASS ready-vector recovery needs no new embedding; concurrent reclaim fences the late previous worker");

 const failed=queued();activate(failed);
 sql(`${server}${finish(failed,1,null,"'EMBEDDING_UNAVAILABLE'").replace("private.finish_memory_index_job","public.complete_memory_index_job")}`);
 assert.equal(state(failed),"failed:retryable_failed:true");
 sql(`UPDATE public.job_runs SET next_run_at=clock_timestamp()-interval '1 second',attempt_count=2 WHERE id='${failed.job}';`);
 const finalAttempt=JSON.parse(sql(claim())).find(j=>j.id===failed.job);assert.equal(finalAttempt.attempt_count,3);
 sql(`${server}${finish(failed,3,null,"'INVALID_EMBEDDING'").replace("private.finish_memory_index_job","public.complete_memory_index_job")}`);assert.equal(state(failed),"failed:dead:true");
 const crashed=queued();sql(`UPDATE public.job_runs SET status='running',attempt_count=3,locked_until=clock_timestamp()-interval '1 second' WHERE id='${crashed.job}';`);sql(claim());assert.equal(sql(`SELECT status FROM public.job_runs WHERE id='${crashed.job}'`).trim(),"dead");
 console.log("PASS actual public failure transaction records recoverable errors, exhausted retries and expired crashes become terminal");

 const match=`public.match_campaign_memories('${business}','${vector}','${model}','${profile}',1,5,0.9)`;
 const hits=JSON.parse(sql(`${user}SELECT json_agg(r) FROM ${match} r;`));assert.ok(hits.length>0&&hits.length<=5);assert.ok(hits.every(r=>r.lessons_json.test_only===true));
 for(const change of[match.replace(model,"wrong-model"),match.replace(profile,"wrong-profile")])assert.equal(sql(`${user}SELECT count(*) FROM ${change}`).trim(),"0");
 reject(`SET ROLE authenticated;SET request.jwt.claim.sub='22222222-2222-4222-8222-222222222222';SELECT count(*) FROM ${match}`,/FORBIDDEN/);
 console.log(`PASS bounded owned compatible pgvector plumbing; ${races} observed PostgreSQL lock races; no production-equivalent eligibility claimed`);
}
