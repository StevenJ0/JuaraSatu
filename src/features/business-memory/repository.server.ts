import "server-only";
import { z } from "zod";
import { SupabaseError, type SupabaseTransport } from "@/lib/supabase/transport.server";
import { evaluationRepository } from "../campaign-evaluation/repository.server";
import { buildEvaluationContext, evaluationCurrentHash } from "../campaign-evaluation";
import { syntheticCampaignAnalytics } from "../campaign-evaluation/development-provider";
import { MemoryError, MemoryRowSchema, MemoryJobSchema, type MemoryRow } from "./contracts";
import type { EmbeddingProfile } from "./embedding";
import { memorySource, validateStoredMemory } from "./domain";
import { generationClaims } from "@/lib/ai/generation-claims.server";

export function memoryDatabaseError(error: unknown): never {
  if (error instanceof MemoryError) throw error;
  if (error instanceof SupabaseError) {
    if (error.code === "42501") throw new MemoryError("FORBIDDEN",403);
    if (error.code === "23503" || error.code === "P0002") throw new MemoryError("NOT_FOUND",404);
    if (error.code === "23505") throw new MemoryError("MEMORY_SOURCE_ALREADY_EXISTS");
    if (error.code === "40001" && ["MEMORY_SOURCE_CONFLICT","STALE_EMBEDDING_JOB","STALE_JOB_LEASE","STALE_MEMORY_SOURCE","STALE_SOURCE_STATE","PROFILE_CHANGE_REQUIRES_REVIEWED_VERSION"].includes(error.detail)) throw new MemoryError(error.detail);
    if (error.code === "40001" || error.code === "40P01") throw new MemoryError("DATABASE_BUSY",503);
    if (error.code === "23514" && ["SYNTHETIC_MEMORY_APPROVAL_FORBIDDEN","VERIFIED_C6_UNAVAILABLE","ELIGIBLE_COMPLETED_EVALUATION_REQUIRED","MEMORY_OWNER_REVIEW_REQUIRED","MEMORY_JOB_BINDING_MISMATCH","ATOMIC_MEMORY_INDEXING_REQUIRED"].includes(error.detail)) throw new MemoryError(error.detail);
    if (error.code === "22023") throw new MemoryError("INVALID_MEMORY_JOB_RESULT",400);
  }
  throw new MemoryError("MEMORY_PERSISTENCE_UNAVAILABLE",503);
}
export function memoryRepository(user: SupabaseTransport, privileged: () => SupabaseTransport, scope: { businessId: string; ownerUserId: string }) {
  const evaluations = evaluationRepository(user, privileged, scope);
  async function source(campaignId: string, evaluationId: string) {
    const row = await evaluations.evaluation(evaluationId); if (!row || row.campaign_id !== campaignId) throw new MemoryError("NOT_FOUND",404);
    if (await evaluations.latestId(campaignId) !== row.id) throw new MemoryError("STALE_MEMORY_SOURCE");
    const facts = await evaluations.facts(campaignId); const now = new Date().toISOString();
    const completion=row.metrics_json.finalization;
    if(facts.snapshot.campaign.status!=="completed"||!completion||facts.snapshot.campaign.version!==completion.completedCampaignVersion||
      !facts.snapshot.campaign.completed_at||Date.parse(facts.snapshot.campaign.completed_at)!==Date.parse(completion.completedAt))throw new MemoryError("ELIGIBLE_COMPLETED_EVALUATION_REQUIRED");
    const current = buildEvaluationContext({ ...facts, now, analyticsScenario: row.metrics_json.context.analyticsScenario,
      analytics: syntheticCampaignAnalytics(facts.snapshot,row.metrics_json.context.analyticsScenario,now,process.env) });
    return memorySource(row,evaluationCurrentHash(current,row));
  }
  async function rows(query: Record<string,string>) {
    return z.array(MemoryRowSchema).max(101).parse(await user.select("campaign_memories", { select:"id,business_id,campaign_id,source_evaluation_id,source_blueprint_id,source_version,summary_text,lessons_json,limitations_json,content_hash,review_status,embedding_status,embedding_model,embedding_profile,embedding_version,approved_at,indexed_at,created_at,updated_at",
      business_id:`eq.${scope.businessId}`,...query })).map(validateStoredMemory);
  }
  return { source, generations: generationClaims(user, privileged, scope.businessId, () => new Date().toISOString(), scope.ownerUserId),
    async jobs(memoryId:string) { return z.array(MemoryJobSchema).max(100).parse(await user.select("job_runs",{select:"id,job_type,entity_id,business_id,dedupe_key,status,attempt_count,locked_until,next_run_at,last_error_code",business_id:`eq.${scope.businessId}`,entity_id:`eq.${memoryId}`,job_type:"eq.embed_memory",order:"created_at.desc",limit:"100"})); },
    async approve(row:MemoryRow,profile:EmbeddingProfile) { return z.uuid().parse(await privileged().rpc("approve_campaign_memory",{p_business_id:scope.businessId,p_memory_id:row.id,p_content_hash:row.content_hash,p_model:profile.model,p_profile:profile.profile,p_actor_user_id:scope.ownerUserId})); },
    async campaigns() { return z.array(z.object({ id:z.uuid(),name:z.string(),status:z.literal("completed") })).parse(await user.select("campaigns",{select:"id,name,status",business_id:`eq.${scope.businessId}`,status:"eq.completed",order:"created_at.desc",limit:"100"})); },
    async latestEvaluationId(id: string) { const row = await evaluations.facts(id); if (row.snapshot.campaign.status !== "completed") throw new MemoryError("ELIGIBLE_COMPLETED_EVALUATION_REQUIRED"); return evaluations.latestId(id); },
    list: (campaignId?:string) => rows({order:"created_at.desc,id.desc",limit:"100",...(campaignId?{campaign_id:`eq.${campaignId}`}:{})}),
    async get(id: string):Promise<MemoryRow|null> { return (await rows({id:`eq.${id}`,limit:"1"}))[0] ?? null; },
    async bySource(evaluationId: string, version: number):Promise<MemoryRow|null> { return (await rows({source_evaluation_id:`eq.${evaluationId}`,source_version:`eq.${version}`,limit:"1"}))[0] ?? null; },
    async insert(row: Omit<MemoryRow,"created_at"|"updated_at">) {
      return MemoryRowSchema.parse(z.array(MemoryRowSchema).length(1).parse(await privileged().insert("campaign_memories",row))[0]);
    },
    async review(row: MemoryRow, payload: MemoryRow["lessons_json"], contentHash: string) {
      return z.array(MemoryRowSchema).max(1).parse(await privileged().update("campaign_memories",{ id:`eq.${row.id}`,business_id:`eq.${scope.businessId}`,review_status:"eq.draft",content_hash:`eq.${row.content_hash}` },{lessons_json:payload,content_hash:contentHash}));
    },
  };
}
export type MemoryRepository = ReturnType<typeof memoryRepository>;
