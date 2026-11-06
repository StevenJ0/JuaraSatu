import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fixtureTokens,call,localFixtureSettings } from "../fixtures/local-campaign.mjs";
import { createMemoryFixture,generateMemoryCommand } from "../fixtures/local-memory.mjs";
const[a,b]=await fixtureTokens();const f=await createMemoryFixture(a);let groups=0;let saved;
async function test(name,work){await work();groups++;console.log(`PASS ${name}`);}
await test("memory HTTP auth, tenant, strict body, size, origin and source guards",async()=>{
  assert.equal((await call(undefined,"memories")).status,401);assert.equal((await call(b,"memories",undefined,`?campaignId=${f.campaignId}`)).status,404);
  const c=generateMemoryCommand(f);assert.equal((await call(b,"memories",c)).status,404);assert.equal((await call(a,"memories",{...c,verified:true})).status,400);
  assert.equal((await call(a,"memories",{...c,padding:"x".repeat(17000)})).status,400);assert.equal((await call(a,"memories",c,"",{Origin:"https://untrusted.example"})).status,403);
  assert.equal((await call(a,"memories",{...c,expectedContextHash:"0".repeat(64)})).body.code,"STALE_MEMORY_SOURCE");
});
await test("memory HTTP failure, invalid and missing-evidence output never persist a candidate",async()=>{
  for(const scenario of["failure","invalid","missing_evidence"]){const r=await call(a,"memories",generateMemoryCommand(f,scenario));assert.ok([502,503].includes(r.status),r.body.code);}
  const r=await call(a,"memories",undefined,`?campaignId=${f.campaignId}`);assert.equal(r.body.memories.length,0);
});
await test("memory HTTP canonical concurrent creation persists one grounded draft",async()=>{
  const c=generateMemoryCommand(f);const results=await Promise.all([call(a,"memories",c),call(a,"memories",c)]);for(const r of results)assert.equal(r.status,200,r.body.code);saved=results[0].body;
  assert.equal(saved.row.review_status,"draft");assert.equal(saved.row.lessons_json.source.synthetic,true);assert.equal(saved.row.lessons_json.source.results.contributionIdr,214000);
  const replay=await call(a,"memories",c);assert.equal(replay.body.replayed,true);assert.equal((await call(a,"memories",{...c,scenario:"invalid"})).body.code,"IDEMPOTENCY_CONFLICT");
  const r=await call(a,"memories",undefined,`?campaignId=${f.campaignId}`);assert.equal(r.body.memories.length,1);assert.equal((await call(b,"memories",undefined,`?memoryId=${saved.row.id}`)).status,404);
});
await test("memory HTTP owner review uses CAS, refresh persists and synthetic approval remains forbidden",async()=>{
  const c={action:"review",memoryId:saved.row.id,requestId:randomUUID(),expectedContentHash:saved.row.content_hash,decision:"reviewed",confirm:true};
  assert.equal((await call(a,"memories",{...c,confirm:false})).status,400);assert.equal((await call(b,"memories",c)).status,404);
  const reviewed=await call(a,"memories",c);assert.equal(reviewed.status,200,reviewed.body.code);saved=reviewed.body;
  assert.equal(saved.row.review_status,"draft");assert.equal(saved.row.lessons_json.ownerReview.decision,"reviewed");assert.equal((await call(a,"memories",c)).body.replayed,true);
  assert.equal((await call(a,"memories",{...c,requestId:randomUUID(),decision:"rejected"})).body.code,"MEMORY_SOURCE_CONFLICT");
  const approval=await call(a,"memories",{action:"approve",memoryId:saved.row.id,expectedContentHash:saved.row.content_hash,confirm:true});assert.equal(approval.status,409);assert.equal(approval.body.code,"SYNTHETIC_MEMORY_APPROVAL_FORBIDDEN");
  assert.equal((await call(a,"memories",undefined,`?memoryId=${saved.row.id}`)).body.row.lessons_json.ownerReview.decision,"reviewed");
});
await test("memory HTTP draft rejection is audited without inventing a database lifecycle",async()=>{
  const r=await call(a,"memories",{action:"review",memoryId:saved.row.id,expectedContentHash:saved.row.content_hash,requestId:randomUUID(),decision:"rejected",confirm:true});assert.equal(r.status,200);saved=r.body;
  assert.equal(saved.row.review_status,"draft");assert.equal(saved.row.lessons_json.ownerReview.decision,"rejected");
});
await test("memory retrieval distinguishes cold-start and does not claim or alter unrelated jobs",async()=>{
  const r=await call(a,"memories",{action:"retrieve",query:"budget pengeluaran promosi preorder",limit:3});assert.equal(r.status,200);assert.equal(r.body.history.status,"cold_start");
  const{env}=localFixtureSettings();const headers={apikey:env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,Authorization:`Bearer ${a}`};
  const url=env.NEXT_PUBLIC_SUPABASE_URL+"/rest/v1/job_runs?select=id,status,attempt_count&order=id";const before=await(await fetch(url,{headers})).json();
  const worker=await call(a,"memories",{action:"run_worker"});assert.equal(worker.status,200);assert.equal(worker.body.status,"idle");assert.equal(worker.body.claimed,0);assert.deepEqual(worker.body.results,[]);
  assert.equal((await call(a,"memories",{action:"run_worker",businessId:"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1"})).status,400);
  assert.deepEqual(await(await fetch(url,{headers})).json(),before);
});
console.log(`${groups} Slice8 HTTP groups passed; candidates remain draft and no production approval/indexing is claimed`);
