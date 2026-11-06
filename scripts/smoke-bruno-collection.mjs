import assert from 'node:assert/strict';
import { readFileSync,writeFileSync,mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { Script,createContext } from 'node:vm';

// Compatibility harness for parsed .bru scripts + real local HTTP, NOT Bruno CLI/GUI execution.
const mutate=process.argv.includes('--allow-local-mutations');
if(!mutate&&!process.argv.includes('--read-only'))throw Error('Choose --read-only or explicit --allow-local-mutations');
execFileSync(process.execPath,['scripts/validate-bruno-collection.mjs'],{stdio:'inherit',windowsHide:true});
const parsed=JSON.parse(readFileSync('node_modules/.cache/bruno-audit/parsed.json','utf8'));
const env=Object.fromEntries(readFileSync('.env.local','utf8').split(/\r?\n/).map(line=>{const i=line.indexOf('=');return[line.slice(0,i),line.slice(i+1)];}));
assert.equal(env.NEXT_PUBLIC_SUPABASE_URL,'http://127.0.0.1:54321');
for(const[k,v]of Object.entries({CAMPAIGN_DISCUSSION_PROVIDER:'fake',CAMPAIGN_DISCUSSION_CONTEXT:'seeded',CAMPAIGN_BLUEPRINT_PROVIDER:'fake',CAMPAIGN_BLUEPRINT_APPROVAL:'synthetic',CAMPAIGN_EXECUTION_MODE:'synthetic',CAMPAIGN_EVALUATION_MODE:'synthetic',CAMPAIGN_MEMORY_PROVIDER:'fake',CAMPAIGN_MEMORY_RETRIEVAL:'fake'}))assert.equal(env[k],v,`Only documented Fake local mode permitted: ${k}`);
const accounts=JSON.parse(readFileSync('node_modules/.cache/database-v21-cutover/fixture-credentials.json','utf8'));
const fixture=JSON.parse(readFileSync('node_modules/.cache/campaign-discussion/preorders.json','utf8'))[0];
const vars=new Map(parsed.env.variables.map(v=>[v.name,v.value]));
vars.set('ownerEmail',accounts[0].email);vars.set('ownerPassword',accounts[0].password);vars.set('ownerBEmail',accounts[1].email);vars.set('ownerBPassword',accounts[1].password);vars.set('preorderId',fixture.preorderId);
vars.set('allowAuth','true');vars.set('confirmFakeProviders','true');if(mutate)for(const flag of ['allowMutations','allowNegative','allowLifecycle'])vars.set(flag,'true');
const cookies=new Map();let count=0;const examples=[];const tested=[];
function interpolate(text){return String(text).replace(/\{\{([^{}]+)\}\}/g,(_,key)=>key==='$randomUUID'?randomUUID():vars.has(key)?String(vars.get(key)):`{{${key}}}`);}
function execute(code,context,label){if(code?.trim())new Script(`(function(){\n${code}\n})()`,{filename:label}).runInContext(context,{timeout:3000});}
const all=parsed.requests.sort((a,b)=>a.path.split('/')[0].localeCompare(b.path.split('/')[0])||Number(a.meta.seq)-Number(b.meta.seq));
// Verify the real mutation and local-only pre-scripts reject unsafe defaults before any HTTP call.
const mutation=all.find(r=>r.path.includes('Create-session'));assert.ok(mutation);
const guardVars=new Map(vars);guardVars.set('allowMutations','false');
const guard=createContext({bru:{getVar:k=>guardVars.get(k),interpolate},req:{getUrl:()=>mutation.http.url}});
assert.throws(()=>execute(mutation.script.req,guard,'default-mutation-guard'),/OPT_IN_REQUIRED/);
const remote=createContext({bru:{getVar:k=>vars.get(k),interpolate},req:{getUrl:()=> 'https://example.com/api/dev/discussions'}});
assert.throws(()=>execute(parsed.collection.script.req,remote,'remote-guard'),/LOCAL_ONLY/);
console.log('PASS mutation default and remote-target guards reject before transport');
for(const request of all){
 if(request.path.startsWith('09-')||request.meta.tags.includes('blocked')||request.meta.tags.includes('real-gemini'))continue;
 if(!mutate&&!['Login-owner-A','Check-cookie-session','List-preorders-and-discussions'].some(name=>request.meta.name.endsWith(name)))continue;
 let body=request.body?.[request.http.body];const headers=Object.fromEntries(request.headers.filter(h=>h.enabled).map(h=>[h.name,interpolate(h.value)]));
 const req={getMethod:()=>request.http.method.toUpperCase(),getUrl:()=>request.http.url,getBody:()=>body,setBody:v=>{body=v;},setHeader:(k,v)=>{headers[k]=v;}};
 const bru={getVar:k=>vars.get(k),setVar:(k,v)=>vars.set(k,v),interpolate};
 const context=createContext({bru,req,test:(_name,work)=>work()});
 try{
  execute(parsed.collection.script.req,context,'collection-pre');execute(request.script?.req,context,request.path+' pre');
  const target=interpolate(request.http.url);assert.ok(target.startsWith('http://localhost:3100/'),'Smoke only targets intended application server');
  const cookie=Array.from(cookies).map(([k,v])=>`${k}=${v}`).join('; ');if(cookie)headers.Cookie=cookie;
  if(body!==undefined&&request.http.body==='json'){body=typeof body==='string'?JSON.parse(interpolate(body)):body;body=JSON.stringify(body);}
  const response=await fetch(target,{method:request.http.method.toUpperCase(),headers,...(body!==undefined?{body}:{}),redirect:'manual',signal:AbortSignal.timeout(30000)});
  for(const line of response.headers.getSetCookie()){const pair=line.split(';')[0],i=pair.indexOf('=');if(pair.slice(i+1))cookies.set(pair.slice(0,i),pair.slice(i+1));else cookies.delete(pair.slice(0,i));}
  const value=await response.json();context.res={getStatus:()=>response.status,getBody:()=>value};
  execute(parsed.collection.script.res,context,'collection-post');execute(request.script?.res,context,request.path+' post');execute(request.tests,context,request.path+' tests');
  count++;tested.push(request.path);console.log(`PASS ${request.path} HTTP${response.status}`);
  // Only selected actual response fields; never request credentials, cookies, tokens or vectors.
  let sample;
  if(request.meta.name.endsWith('Discount-Fake-strategy'))sample={success:value.success,status:value.status,persisted:value.persisted,proposal:{sessionId:value.proposal.sessionId,proposalVersion:value.proposal.proposalVersion,persistence:value.proposal.persistence,status:value.proposal.status}};
  if(request.meta.name.endsWith('Read-approved-still-draft'))sample={campaign:{id:value.campaign.id,status:value.campaign.status,version:value.campaign.version},active:{id:value.active.id,version:value.active.version,approval_status:value.active.approval_status}};
  if(request.meta.name.endsWith('Finalize-development-simulation'))sample={campaignStatus:value.context.snapshot.campaign.status,synthetic:value.synthetic,latestEvaluationId:value.latestEvaluationId,finalization:value.history.find(h=>h.row.id===value.latestEvaluationId).row.metrics_json.finalization};
  if(request.meta.name.endsWith('Generate-persisted-draft'))sample={memoryId:value.row.id,review_status:value.row.review_status,embedding_status:value.row.embedding_status,synthetic:value.synthetic,approval:value.approval,indexing:value.indexing};
  if(request.meta.name.endsWith('Reject-synthetic-memory-approval')||request.meta.name.endsWith('Run-scoped-worker-expect-idle')||request.meta.name.endsWith('Retrieve-historical-memory-expect-cold-start'))sample=value;
  if(sample)examples.push({request:request.path,httpStatus:response.status,actualResponseProjection:sample});
 }catch(error){console.error(`FAIL ${request.path}: ${error.message}`);process.exitCode=1;break;}
}
mkdirSync('node_modules/.cache/bruno-audit',{recursive:true});
writeFileSync('node_modules/.cache/bruno-audit/smoke-result.json',JSON.stringify({harness:'native parsed .bru + Node VM compatibility + real HTTP; not Bruno CLI',mutatingOptIn:mutate,passed:count,failed:!!process.exitCode,tested,completedCampaignId:vars.get('campaignId')??null,examples},null,2));
console.log(`${count} parsed-collection HTTP cases passed; official Bruno CLI/GUI runtime not verified; no paid provider calls`);
