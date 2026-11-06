import { randomUUID } from "node:crypto";
import { it,expect,vi } from "vitest";
vi.mock("server-only",()=>({}));
import { memoryFixture } from "../fixtures/memory";
import { memoryContentHash } from "../../src/features/business-memory/domain";
import { fakeEmbeddingProvider } from "../../src/features/business-memory/embedding";
import { retrieveMemoryHistory,historicalMemoryProjection } from "../../src/features/business-memory/retrieval.server";
import type { SupabaseTransport } from "../../src/lib/supabase/transport.server";
async function fixture(){const f=await memoryFixture();const row=structuredClone(f.row);const p=fakeEmbeddingProvider(true);
  // Hypothetical adapter fixture only; no production-approved record is seeded into PostgreSQL.
  row.lessons_json.source.synthetic=false;row.lessons_json.source.productionEligible=true;row.lessons_json.source.results.synthetic=false;row.lessons_json.source.results.provisional=false;
  row.lessons_json.ownerReview={decision:"reviewed",ownerUserId:f.owner,reviewedAt:f.now,requestId:randomUUID(),expectedContentHash:row.content_hash};row.review_status="approved";row.embedding_status="ready";row.embedding_model=p.configuration.model;row.embedding_profile=p.configuration.profile;row.content_hash=memoryContentHash(row);
  const matches=[{memory_id:row.id,campaign_id:row.campaign_id,source_evaluation_id:row.source_evaluation_id,summary_text:row.summary_text,lessons_json:row.lessons_json,limitations_json:row.limitations_json,similarity:0.9}];
  const calls:{name:string;args:unknown}[]=[];
  const transport:SupabaseTransport={select:async()=>[row],insert:async()=>[],update:async()=>[],rpc:async(name,args)=>{calls.push({name,args});return name==="is_business_owner"?true:matches;}};
  return{...f,row,p,transport,matches,calls};}
it("does not treat claimed verified metadata as a trusted C7 attestation",async()=>{const f=await fixture();expect(await retrieveMemoryHistory(f.transport,f.row.business_id,{query:"budget promosi"},f.p,()=>f.now)).toEqual({status:"unavailable",reason:"not_implemented"});expect(f.calls.some(c=>c.name==="match_campaign_memories")).toBe(false);});
it("attested compatible port results include exact memory/evaluation references",async()=>{const f=await fixture();const r=await retrieveMemoryHistory(f.transport,f.row.business_id,{query:"budget promosi",limit:3},f.p,()=>f.now,async()=>true);expect(r).toMatchObject({status:"available",memories:[{memoryId:f.row.id,evaluationId:f.row.source_evaluation_id,sourceVersion:f.row.source_version}]});expect(f.calls.find(c=>c.name==="match_campaign_memories")?.args).toMatchObject({p_business_id:f.row.business_id,p_model:f.p.configuration.model,p_profile:f.p.configuration.profile,p_embedding_version:1,p_limit:3});});
it("distinguishes no-match from absent approved history",async()=>{const f=await fixture();f.matches.splice(0);expect(await retrieveMemoryHistory(f.transport,f.row.business_id,{query:"other topic"},f.p,()=>f.now,async()=>true)).toMatchObject({status:"no_match"});});
it("rejects foreign rows and incompatible profile metadata at the runtime boundary",async()=>{const f=await fixture();f.row.business_id=randomUUID();expect(await retrieveMemoryHistory(f.transport,f.source.businessId,{query:"budget promosi"},f.p,()=>f.now,async()=>true)).toMatchObject({status:"unavailable"});const g=await fixture();g.row.embedding_profile="wrong-profile";expect(await retrieveMemoryHistory(g.transport,g.row.business_id,{query:"budget promosi"},g.p,()=>g.now,async()=>true)).toMatchObject({status:"unavailable"});});
it("rejects invented result IDs and source changes after matching",async()=>{const f=await fixture();f.matches[0].source_evaluation_id=randomUUID();expect(await retrieveMemoryHistory(f.transport,f.row.business_id,{query:"budget promosi"},f.p,()=>f.now,async()=>true)).toMatchObject({status:"unavailable"});const g=await fixture();let checks=0;expect(await retrieveMemoryHistory(g.transport,g.row.business_id,{query:"budget promosi"},g.p,()=>g.now,async()=>++checks===1)).toMatchObject({status:"unavailable"});});
it("synthetic/unapproved sources cannot be projected as historical strategy evidence",async()=>{const f=await memoryFixture();expect(()=>historicalMemoryProjection(f.row,0.9)).toThrow("INELIGIBLE_MEMORY");});
