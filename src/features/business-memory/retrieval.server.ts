import "server-only";
import { z } from "zod";
import { HistoricalMemorySchema, type BuildBusinessContextInput } from "../ai-context";
import type { SupabaseTransport } from "@/lib/supabase/transport.server";
import { validateStoredMemory } from "./domain";
import { embedValidated, fakeEmbeddingProvider, EmbeddingProfileSchema, type EmbeddingProvider } from "./embedding";
import { geminiEmbeddingProvider } from "./gemini-embedding.server";
import { MemoryError, RetrievalCommandSchema, MemoryRowSchema, type MemoryRow } from "./contracts";
export type MemoryRetrievalEnvironment = { NODE_ENV?:string; CAMPAIGN_MEMORY_RETRIEVAL?:string; GEMINI_API_KEY?:string; GEMINI_EMBEDDING_MODEL?:string };
export function configuredEmbedding(env: MemoryRetrievalEnvironment): EmbeddingProvider {
  if(env.CAMPAIGN_MEMORY_RETRIEVAL==="fake")return fakeEmbeddingProvider(["test","development"].includes(env.NODE_ENV??""));
  if(env.CAMPAIGN_MEMORY_RETRIEVAL==="gemini")return geminiEmbeddingProvider({apiKey:env.GEMINI_API_KEY,model:env.GEMINI_EMBEDDING_MODEL});
  throw new MemoryError("EMBEDDING_CONFIGURATION_REQUIRED",503);
}
const Match = z.object({memory_id:z.uuid(),campaign_id:z.uuid(),source_evaluation_id:z.uuid(),summary_text:z.string(),lessons_json:z.unknown(),limitations_json:z.unknown(),similarity:z.number().finite().min(-1).max(1)});
export async function retrieveMemoryHistory(user: SupabaseTransport, businessId:string, raw:unknown, provider:EmbeddingProvider, now:()=>string,
  attestSource:((row:MemoryRow)=>Promise<boolean>)|null=null):Promise<BuildBusinessContextInput["history"]> {
  try {
    const command=RetrievalCommandSchema.parse(raw);
    if(await user.rpc("is_business_owner",{target_business_id:businessId})!==true)throw new MemoryError("FORBIDDEN",403);
    const profile=EmbeddingProfileSchema.parse(provider.configuration);
    const rows=z.array(z.unknown()).max(101).parse(await user.select("campaign_memories",{select:Object.keys(MemoryRowSchema.shape).join(","),business_id:`eq.${businessId}`,review_status:"eq.approved",embedding_status:"eq.ready",
      embedding_model:`eq.${profile.model}`,embedding_profile:`eq.${profile.profile}`,embedding_version:`eq.${profile.version}`,limit:"101"}));
    if(rows.length>100)throw new MemoryError("MEMORY_WINDOW_LIMIT",503);
    const candidates=rows.map(validateStoredMemory);
    if(candidates.some((m)=>m.business_id!==businessId||m.review_status!=="approved"||m.embedding_status!=="ready"||m.embedding_model!==profile.model||m.embedding_profile!==profile.profile||m.embedding_version!==profile.version))throw new MemoryError("INVALID_RETRIEVAL_SOURCE");
    const eligible=candidates.filter((m)=>!m.lessons_json.source.synthetic && m.lessons_json.source.productionEligible && m.lessons_json.ownerReview.decision==="reviewed");
    if(!eligible.length)return{status:"cold_start",businessId,checkedAt:now()};
    // shortcut: verified C7 freshness cannot be attested with current adapters; supply that producer before enabling verified retrieval.
    if(!attestSource)return{status:"unavailable",reason:"not_implemented"};
    const trusted:MemoryRow[]=[];for(const row of eligible)if(await attestSource(row))trusted.push(row);
    if(!trusted.length)return{status:"unavailable",reason:"read_failed"};
    const matches=await matchMemoryVectors(user,businessId,command,provider);const memories=[];
    for(const match of matches){const row=trusted.find((r)=>r.id===match.memory_id);if(!row){if(!candidates.some((m)=>m.id===match.memory_id))throw new MemoryError("INVALID_RETRIEVAL_SOURCE");continue;}
      if(match.campaign_id!==row.campaign_id||match.source_evaluation_id!==row.source_evaluation_id||match.summary_text!==row.summary_text||!(await attestSource(row)))throw new MemoryError("STALE_MEMORY_SOURCE");
      memories.push(historicalMemoryProjection(row,match.similarity));}
    return memories.length?{status:"available",businessId,checkedAt:now(),memories}:{status:"no_match",businessId,checkedAt:now()};
  } catch(error) { if(error instanceof MemoryError&&error.code==="FORBIDDEN")return{status:"unavailable",reason:"forbidden"};return{status:"unavailable",reason:"read_failed"}; }
}
/** Scoped SQL primitive; callers must separately attest source eligibility before using results as strategy evidence. */
export async function matchMemoryVectors(user:SupabaseTransport,businessId:string,query:unknown,provider:EmbeddingProvider) {
  z.uuid().parse(businessId);const command=RetrievalCommandSchema.parse(query);
  if(await user.rpc("is_business_owner",{target_business_id:businessId})!==true)throw new MemoryError("FORBIDDEN",403);
  const vector=await embedValidated(provider,command.query,"query");const p=provider.configuration;
  return z.array(Match).max(5).parse(await user.rpc("match_campaign_memories",{p_business_id:businessId,p_embedding:JSON.stringify(vector),p_model:p.model,p_profile:p.profile,p_embedding_version:p.version,p_limit:command.limit,p_min_similarity:0.35}));
}
export function historicalMemoryProjection(row:unknown,similarity:number) {
  const m=validateStoredMemory(row);const s=m.lessons_json.source;
  if(m.review_status!=="approved"||m.embedding_status!=="ready"||s.synthetic||!s.productionEligible||!m.embedding_model||!m.embedding_profile)throw new MemoryError("INELIGIBLE_MEMORY");
  return HistoricalMemorySchema.parse({memoryId:m.id,businessId:m.business_id,campaignId:m.campaign_id,evaluationId:m.source_evaluation_id,sourceVersion:m.source_version,contentHash:m.content_hash,
    summary:m.summary_text,lessons:m.lessons_json.interpretation.lessons.slice(0,3).map((text)=>text.slice(0,300)),limitations:[...m.limitations_json.slice(0,4).map((text)=>text.slice(0,300)),"Lihat evaluasi sumber untuk rincian dan seluruh keterbatasan."],model:m.embedding_model,profile:m.embedding_profile,embeddingVersion:m.embedding_version,
    sourceFactsAt:s.sourceFactsAt,similarity,provenance:"verified"});
}
