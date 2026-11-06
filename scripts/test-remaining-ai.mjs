
// Local-only E2E. Credentials stay in memory. Live generation has a durable one-call cap per module.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
const campaignId = "c8f2a641-9b73-4e02-a7d5-61c90b38f254";
const origin = "http://localhost:3000", directory = "node_modules/.cache/remaining-ai-e2e", statePath = directory + "/state.json";
const env = Object.fromEntries(readFileSync(".env.local","utf8").split(/\r?\n/).filter(l=>/^[A-Z_]+=/.test(l)).map(l=>{const at=l.indexOf("=");return[l.slice(0,at),l.slice(at+1).replace(/^["']|["']$/g,"")];}));
assert.equal(env.NEXT_PUBLIC_SUPABASE_URL,"http://127.0.0.1:54321");
mkdirSync(directory,{recursive:true});
const state = existsSync(statePath)?JSON.parse(readFileSync(statePath,"utf8")):{campaignId,attempts:{},results:[]};
assert.equal(state.campaignId,campaignId);
const save=()=>writeFileSync(statePath,JSON.stringify(state,null,2)+"\n");
function sql(query){return JSON.parse(execFileSync("docker",["exec","-i","supabase_db_campaign-lab","psql","-U","postgres","-d","postgres","-X","-qAt","-v","ON_ERROR_STOP=1"],{input:query,encoding:"utf8",stdio:["pipe","pipe","pipe"]}).trim());}
const owner = sql("SELECT jsonb_build_object('id',u.id,'email',u.email,'businessId',m.business_id) FROM auth.users u JOIN public.business_members m ON m.user_id=u.id JOIN public.campaigns c ON c.business_id=m.business_id WHERE c.id='"+campaignId+"' AND m.role='owner' LIMIT 1;");
async function auth(identity){
  const key=env.SUPABASE_SERVICE_ROLE_KEY;
  const generated=await fetch(env.NEXT_PUBLIC_SUPABASE_URL+"/auth/v1/admin/generate_link",{method:"POST",headers:{apikey:key,Authorization:"Bearer "+key,"Content-Type":"application/json"},body:JSON.stringify({type:"magiclink",email:identity.email}),signal:AbortSignal.timeout(10000)});
  assert.equal(generated.status,200,"LOCAL_LINK_GENERATION_FAILED");
  const link=await generated.json();
  const response=await fetch(env.NEXT_PUBLIC_SUPABASE_URL+"/auth/v1/verify",{method:"POST",headers:{apikey:env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY??env.NEXT_PUBLIC_PUBLISHABLE_KEY,"Content-Type":"application/json"},body:JSON.stringify({type:"magiclink",token_hash:link.hashed_token??link.properties?.hashed_token}),signal:AbortSignal.timeout(10000)});
  assert.equal(response.status,200,"LOCAL_SESSION_VERIFICATION_FAILED");
  const session=await response.json();assert.equal(session.user.id,identity.id);return session.access_token;
}
const token=await auth(owner);
async function call(module,body,query="",credentials=token){
 const response=await fetch(origin+"/api/dev/"+module+query,{method:body?"POST":"GET",headers:{Authorization:"Bearer "+credentials,Origin:origin,"Content-Type":"application/json"},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(90000)});
 const value=await response.json();return{status:response.status,body:value};
}
function ok(result,name){assert.equal(result.status,200,name+": "+(result.body.code??result.status));return result.body;}
async function evaluation(){return ok(await call("evaluations",null,"?campaignId="+campaignId+"&scenario=exceeds_target"),"EVALUATION_READ");}
function record(name,details={}){state.results.push({name,...details,at:new Date().toISOString()});save();console.log(JSON.stringify({name,...details}));}
const baseline=sql("SELECT jsonb_build_object('status',status,'version',version,'baselineHash',md5(baseline_json::text),'baseline',baseline_json) FROM public.campaigns WHERE id='"+campaignId+"';");
state.baseline??=baseline;assert.equal(baseline.baselineHash,state.baseline.baselineHash,"BASELINE_CHANGED");
if(process.argv.includes("--preflight")){
 const view=await evaluation();state.preflight={campaignVersion:view.context.snapshot.campaign.version,provider:env.CAMPAIGN_EVALUATION_PROVIDER,synthetic:view.synthetic,kpiProvenance:view.context.analytics.status==="available"?view.context.analytics.data.provenance:null};
 record("preflight",state.preflight);
}else if(process.argv.includes("--independent")){
 const view=await evaluation();
 const countStarts=()=>readFileSync(".next/dev/logs/next-development.log","utf8").split("\n").filter(l=>l.includes("SDK_REQUEST")&&l.includes("STARTED")).length;
 const starts=countStarts();
 if(state.attempts.evaluation){assert.equal(ok(await call("evaluations",state.attempts.evaluation.command),"REPLAY_PERSISTED_EVALUATION").replayed,true);}
 const negative={action:"generate",campaignId,requestId:randomUUID(),expectedCampaignVersion:view.context.snapshot.campaign.version,expectedEvaluationId:view.latestEvaluationId,expectedContextHash:view.context.contextHash,analyticsScenario:"exceeds_target",providerScenario:"failure"};
 const rejected=await call("evaluations",negative);assert.equal(rejected.status,400);assert.equal(rejected.body.code,"FAKE_SCENARIO_DISABLED");
 assert.equal((await call("evaluations",null,"?campaignId="+campaignId,"")).status,401);
 if(state.evaluationId && view.history.find(e=>e.row.id===state.evaluationId)?.row.analysis_json.status!=="available"){
  const command={campaignId,requestId:randomUUID(),evaluationId:state.evaluationId,expectedCampaignVersion:view.context.snapshot.campaign.version,expectedContextHash:view.context.contextHash,confirm:true};
  assert.equal((await call("evaluations",{...command,action:"review"})).body.code,"NARRATIVE_REVIEW_UNAVAILABLE");
  assert.equal((await call("evaluations",{...command,action:"finalize"})).body.code,"OWNER_REVIEW_REQUIRED");
 }

 const other=sql("SELECT jsonb_build_object('id',u.id,'email',u.email,'businessId',m.business_id) FROM auth.users u JOIN public.business_members m ON m.user_id=u.id WHERE m.business_id<>'"+owner.businessId+"' AND m.role='owner' LIMIT 1;");
 const otherToken=await auth(other);assert.equal((await call("evaluations",null,"?campaignId="+campaignId,otherToken)).status,404);
 assert.equal((await call("memories",null,"?campaignId="+campaignId,otherToken)).status,404);
 const memoryResult=await call("memories",null,"?campaignId="+campaignId);
 assert([200,409].includes(memoryResult.status));const memory=memoryResult.body;
 const jobs=sql("SELECT to_jsonb(count(*)) FROM public.job_runs WHERE business_id='"+owner.businessId+"' AND job_type='embed_memory' AND status IN ('queued','retryable_failed');");
 assert.equal(jobs,0,"SCOPED_WORKER_WOULD_INVOKE_PROVIDER");
 assert.equal(ok(await call("memories",{action:"run_worker"}),"IDLE_WORKER").status,"idle");
 assert.equal(ok(await call("memories",{action:"retrieve",query:"Pembelajaran pengingat preorder",limit:3}),"COLD_START").history.status,"cold_start");
 assert.equal(countStarts(),starts,"UNEXPECTED_GENERATION_DURING_NEGATIVE_OR_REPLAY");
 record("independent-http-security-replay",{unauthorized:401,crossTenant:404,fakeScenario:400,providerInvocations:0,worker:"idle",retrieval:"cold_start",memorySourceError:memory.sourceError??memory.code});
}else if(process.argv.includes("--evaluation-extra")){
 assert(process.argv.includes("--allow-additional-evaluation"),"ADDITIONAL_APPROVAL_REQUIRED");
 assert(state.attempts.evaluation,"INITIAL_SMOKE_REQUIRED");assert(!state.attempts.evaluationExtra,"ADDITIONAL_LIVE_BUDGET_USED");
 let view=await evaluation();assert.equal(view.context.snapshot.campaign.status,"closed");assert.equal(view.summary.actualPromotionSpendIdr,8000);
 const command={action:"generate",campaignId,requestId:randomUUID(),expectedCampaignVersion:view.context.snapshot.campaign.version,expectedEvaluationId:view.latestEvaluationId,expectedContextHash:view.context.contextHash,analyticsScenario:"exceeds_target",providerScenario:"valid"};
 state.attempts.evaluationExtra={command,startedAt:new Date().toISOString(),approval:"one additional free-tier evaluation explicitly authorized"};save();
 const started=Date.now(),result=await call("evaluations",command);state.attempts.evaluationExtra.outcome={httpStatus:result.status,durationMs:Date.now()-started};save();
 view=ok(result,"ADDITIONAL_LIVE_EVALUATION");const row=view.history.find(e=>e.row.id===command.requestId)?.row;assert(row);state.evaluationId=row.id;save();
 record("additional-live-evaluation",{...state.attempts.evaluationExtra.outcome,provider:row.analysis_json.provider,model:row.analysis_json.model,status:row.analysis_json.status,providerIdAvailable:row.analysis_json.providerRequestId!==null});
 assert.equal(row.analysis_json.status,"available","LIVE_OUTPUT_NOT_AVAILABLE");assert.equal(row.analysis_json.provider,"gemini");
 assert.equal(ok(await call("evaluations",command),"REPLAY_EVALUATION").replayed,true);
 assert.equal((await call("evaluations",{...command,expectedContextHash:"0".repeat(64)})).status,409);
 record("additional-evaluation-persistence-replay",{evaluationId:row.id,review:"pending",lifecycle:"closed"});
}else if(process.argv.includes("--evaluation")){
 assert(process.argv.includes("--allow-free-tier-live"),"LIVE_OPT_IN_REQUIRED");assert(!state.attempts.evaluation,"EVALUATION_LIVE_BUDGET_ALREADY_USED");
 let view=await evaluation();assert.equal(view.context.snapshot.campaign.status,"closed");
 const costId=state.costId??randomUUID(),replacementId=state.replacementId??randomUUID();state.costId=costId;state.replacementId=replacementId;save();
 const expense={action:"create_cost",campaignId,requestId:costId,category:"advertising",description:"Pengeluaran fixture E2E sintetis; bukan transaksi usaha nyata",amountIdr:12000,incurredAt:new Date().toISOString()};
 ok(await call("evaluations",expense),"CREATE_EXPENSE");assert.equal(ok(await call("evaluations",expense),"REPLAY_EXPENSE").replayed,true);
 assert.equal((await call("evaluations",{...expense,amountIdr:12001})).status,409);
 view=await evaluation();let entry=view.context.costs.find(c=>c.id===costId);assert(entry);
 const voidCommand={action:"void_cost",campaignId,costId,expectedCostVersion:entry.version,reason:"Pembatalan fixture audit E2E; diganti pencatatan sintetis"};
 ok(await call("evaluations",voidCommand),"VOID_EXPENSE");assert.equal(ok(await call("evaluations",voidCommand),"REPLAY_VOID").replayed,true);
 ok(await call("evaluations",{...expense,requestId:replacementId,amountIdr:8000}),"REPLACEMENT_EXPENSE");
 view=await evaluation();assert(view.context.costs.find(c=>c.id===costId)?.voided_at);assert.equal(view.summary.recordedSpendSubtotalIdr,8000);
 ok(await call("evaluations",{action:"review_costs",campaignId,expectedCampaignVersion:view.context.snapshot.campaign.version,confirm:true}),"REVIEW_COSTS");
 view=await evaluation();assert.equal(view.summary.actualPromotionSpendIdr,8000);
 assert.equal(view.summary.budgetVarianceIdr,8000-view.summary.budgetCapIdr);
 const m=view.summary.observed;if(m.scopedFulfilledSalesValueIdr!==null&&m.scopedProductionCostIncurredIdr!==null)assert.equal(view.summary.contributionIdr,m.scopedFulfilledSalesValueIdr-m.scopedProductionCostIncurredIdr-8000);
 record("expenses-kpi",{campaignVersion:view.context.snapshot.campaign.version,subtotal:8000,voidedHistoryPreserved:true,synthetic:view.summary.synthetic,checklist:[view.summary.completedTasks,view.summary.totalTasks]});
 const command={action:"generate",campaignId,requestId:randomUUID(),expectedCampaignVersion:view.context.snapshot.campaign.version,expectedEvaluationId:view.latestEvaluationId,expectedContextHash:view.context.contextHash,analyticsScenario:"exceeds_target",providerScenario:"valid"};
 assert.equal((await call("evaluations",{...command,requestId:randomUUID(),expectedContextHash:"0".repeat(64)})).status,409);
 assert.equal((await call("evaluations",{...command,requestId:randomUUID(),expectedCampaignVersion:1})).status,409);
 state.attempts.evaluation={command,startedAt:new Date().toISOString()};save();
 const started=Date.now(),result=await call("evaluations",command);state.attempts.evaluation.outcome={httpStatus:result.status,durationMs:Date.now()-started};save();
 view=ok(result,"LIVE_EVALUATION");
 const row=view.history.find(e=>e.row.id===command.requestId)?.row;assert(row,"EVALUATION_NOT_PERSISTED");state.evaluationId=row.id;save();
 record("live-evaluation",{...state.attempts.evaluation.outcome,provider:row.analysis_json.provider,model:row.analysis_json.model,status:row.analysis_json.status,providerIdAvailable:row.analysis_json.providerRequestId!==null});
 assert.equal(row.analysis_json.provider,"gemini");assert.equal(row.analysis_json.status,"available","LIVE_OUTPUT_NOT_AVAILABLE");
 assert.equal(ok(await call("evaluations",command),"REPLAY_EVALUATION").replayed,true);
 assert.equal((await call("evaluations",{...command,expectedContextHash:"0".repeat(64)})).status,409);
 const review={action:"review",campaignId,requestId:randomUUID(),evaluationId:row.id,expectedCampaignVersion:view.context.snapshot.campaign.version,expectedContextHash:view.context.contextHash,confirm:true};
 view=ok(await call("evaluations",review),"OWNER_REVIEW");
 assert.equal((await call("evaluations",{...review,requestId:randomUUID(),expectedContextHash:"0".repeat(64)})).status,409);
 const finalize={...review,action:"finalize",requestId:randomUUID(),evaluationId:review.requestId};
 view=ok(await call("evaluations",finalize),"FINALIZE");
 assert.equal(view.context.snapshot.campaign.status,"completed");assert.equal(ok(await call("evaluations",finalize),"REPLAY_FINALIZE").replayed,true);
 state.finalEvaluationId=finalize.requestId;save();
 assert.equal(sql("SELECT to_jsonb(md5(baseline_json::text)) FROM public.campaigns WHERE id='"+campaignId+"';"),state.baseline.baselineHash);
 record("review-finalization",{finalEvaluationId:state.finalEvaluationId,campaignVersion:view.context.snapshot.campaign.version,mode:"development_synthetic",baselineUnchanged:true});
}else if(process.argv.includes("--memory")){
 assert(process.argv.includes("--allow-free-tier-live"),"LIVE_OPT_IN_REQUIRED");assert(!state.attempts.memory,"MEMORY_LIVE_BUDGET_ALREADY_USED");assert(state.finalEvaluationId,"FINAL_EVALUATION_REQUIRED");
 const view=ok(await call("memories",null,"?campaignId="+campaignId),"MEMORY_SOURCE");assert(view.source,"FINAL_SOURCE_UNAVAILABLE");
 const command={action:"generate",campaignId,evaluationId:view.source.evaluationId,expectedContextHash:view.source.contextHash,requestId:randomUUID()};
 assert.equal((await call("memories",{...command,expectedContextHash:"0".repeat(64)})).status,409);
 state.attempts.memory={command,startedAt:new Date().toISOString()};save();
 const started=Date.now(),result=await call("memories",command);state.attempts.memory.outcome={httpStatus:result.status,durationMs:Date.now()-started};save();
 let memory=ok(result,"LIVE_MEMORY");state.memoryId=memory.row.id;save();
 record("live-memory",{...state.attempts.memory.outcome,provider:memory.row.lessons_json.provider,model:memory.row.lessons_json.model,synthetic:memory.synthetic,providerIdAvailable:memory.row.lessons_json.providerRequestId!==null});
 assert.equal(memory.row.lessons_json.provider,"gemini");assert.equal(memory.replayed,false,"EXISTING_CANDIDATE_IS_NOT_NEW_INFERENCE");
 assert.equal(ok(await call("memories",command),"MEMORY_REPLAY").replayed,true);
 assert.equal((await call("memories",{...command,expectedContextHash:"0".repeat(64)})).status,409);
 for(const decision of ["reviewed","rejected","reviewed"]){
  const review={action:"review",memoryId:memory.row.id,requestId:randomUUID(),expectedContentHash:memory.row.content_hash,decision,confirm:true};
  memory=ok(await call("memories",review),"MEMORY_"+decision);
  assert.equal(ok(await call("memories",review),"MEMORY_REVIEW_REPLAY").replayed,true);
 }
 assert.equal((await call("memories",{action:"approve",memoryId:memory.row.id,expectedContentHash:memory.row.content_hash,confirm:true})).body.code,"SYNTHETIC_MEMORY_APPROVAL_FORBIDDEN");
 const worker=ok(await call("memories",{action:"run_worker"}),"SCOPED_WORKER");assert.equal(worker.status,"idle");
 const retrieved=ok(await call("memories",{action:"retrieve",query:"Pembelajaran pengingat preorder secara manual",limit:3}),"RETRIEVE");assert.equal(retrieved.history.status,"cold_start");
 const other=sql("SELECT jsonb_build_object('id',u.id,'email',u.email,'businessId',m.business_id) FROM auth.users u JOIN public.business_members m ON m.user_id=u.id WHERE m.business_id<>'"+owner.businessId+"' AND m.role='owner' LIMIT 1;");
 const otherToken=await auth(other);
 assert.equal((await call("memories",null,"?memoryId="+memory.row.id,otherToken)).status,404);
 assert.equal((await call("evaluations",null,"?campaignId="+campaignId,otherToken)).status,404);
 record("memory-review-security",{memoryId:memory.row.id,approval:"SYNTHETIC_MEMORY_APPROVAL_FORBIDDEN",worker:"idle",retrieval:"cold_start",crossTenant:"denied",productionEligible:false});
}else throw Error("Choose --preflight, --evaluation or --memory");

