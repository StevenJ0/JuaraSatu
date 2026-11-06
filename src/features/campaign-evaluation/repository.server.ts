import "server-only";
import { z } from "zod";
import { SupabaseError, type SupabaseTransport } from "@/lib/supabase/transport.server";
import { executionRepository } from "../campaign-execution/repository.server";
import { CostSchema, EvaluationRowSchema, EvaluationError, type CampaignCost, type EvaluationRow } from "./contracts";
import { generationClaims } from "@/lib/ai/generation-claims.server";

export function evaluationDatabaseError(error: unknown): never {
  if (error instanceof EvaluationError) throw error;
  if (error instanceof SupabaseError) {
    if (error.code === "42501") throw new EvaluationError("FORBIDDEN", 403);
    if (error.code === "23503" || error.code === "P0002") throw new EvaluationError("NOT_FOUND", 404);
    if (error.code === "23505" || error.code === "40001" && error.detail === "IDEMPOTENCY_CONFLICT") throw new EvaluationError("IDEMPOTENCY_CONFLICT");
    if (error.code === "40001" && error.detail === "VERSION_CONFLICT") throw new EvaluationError("VERSION_CONFLICT");
    if (error.code === "40001" && ["STALE_EVALUATION_VERSION", "STALE_SOURCE_STATE"].includes(error.detail)) throw new EvaluationError(error.detail);
    if (error.code === "40001" || error.code === "40P01") throw new EvaluationError("DATABASE_BUSY", 503);
    if (error.code === "23514" && ["CLOSED_CAMPAIGN_REQUIRED", "OWNER_REVIEW_REQUIRED", "EVALUATION_REQUIRED", "COSTS_INCOMPLETE", "KPI_INCOMPLETE",
      "VERIFIED_C6_UNAVAILABLE", "SYNTHETIC_COHORT_REQUIRED", "COMPLETED_CAMPAIGN_IMMUTABLE", "INVALID_EVALUATION_REVIEW"].includes(error.detail)) throw new EvaluationError(error.detail);
    if (error.code === "23514") throw new EvaluationError("EVALUATION_REJECTED");
  }
  throw new EvaluationError("PERSISTENCE_UNAVAILABLE", 503);
}
export function evaluationRepository(user: SupabaseTransport, privileged: () => SupabaseTransport, scope: { businessId: string; ownerUserId: string }) {
  const execution = executionRepository(user, privileged, scope);
  async function metadata(campaignId: string) {
    const rows = z.array(z.object({ id: z.uuid(), version: z.number().int().positive(), costs_completeness: z.enum(["unreviewed", "confirmed_complete"]) })).parse(
      await user.select("campaigns", { select: "id,version,costs_completeness", id: `eq.${campaignId}`, business_id: `eq.${scope.businessId}` }));
    if (!rows[0]) throw new EvaluationError("NOT_FOUND", 404); return rows[0];
  }
  async function costs(campaignId: string) { return z.array(CostSchema).max(100).parse(await user.select("campaign_costs", { select: "*",
    campaign_id: `eq.${campaignId}`, business_id: `eq.${scope.businessId}`, order: "created_at,id", limit: "101" })); }
  async function facts(campaignId: string) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const snapshot = await execution.load(campaignId); const entries = await costs(campaignId); const current = await metadata(campaignId);
      if (current.version === snapshot.campaign.version) return { snapshot, costs: entries, costsCompleteness: current.costs_completeness };
    }
    throw new EvaluationError("VERSION_CONFLICT");
  }
  async function cost(id: string): Promise<CampaignCost | null> { return z.array(CostSchema).max(1).parse(await user.select("campaign_costs", {
    select: "*", id: `eq.${id}`, business_id: `eq.${scope.businessId}` }))[0] ?? null; }
  async function evaluation(id: string): Promise<EvaluationRow | null> {
    const rows = z.array(EvaluationRowSchema).max(1).parse(await user.select("campaign_evaluations", { select: "*", id: `eq.${id}`, business_id: `eq.${scope.businessId}` })); return rows[0] ?? null;
  }
  return { facts, cost, evaluation, generations: generationClaims(user, privileged, scope.businessId, () => new Date().toISOString(), scope.ownerUserId),
    async list() { return z.array(z.object({ id: z.uuid(), name: z.string(), status: z.enum(["closed", "completed"]) })).parse(await user.select("campaigns", {
      select: "id,name,status", business_id: `eq.${scope.businessId}`, status: "in.(closed,completed)", order: "created_at.desc", limit: "100" })); },
    async history(campaignId: string) {
      const rows = z.array(z.unknown()).parse(await user.select("campaign_evaluations", { select: "*", campaign_id: `eq.${campaignId}`, business_id: `eq.${scope.businessId}`, order: "created_at.desc,id.desc", limit: "20" }));
      const parsed = rows.map((row) => EvaluationRowSchema.safeParse(row));
      return { records: parsed.flatMap((row) => row.success ? [row.data] : []), unsupportedCount: parsed.filter((row) => !row.success).length };
    },
    async latestId(campaignId: string) {
      return z.array(z.object({ id: z.uuid() })).max(1).parse(await user.select("campaign_evaluations", { select: "id", campaign_id: `eq.${campaignId}`,
        business_id: `eq.${scope.businessId}`, order: "created_at.desc,id.desc", limit: "1" }))[0]?.id ?? null;
    },
    async save(id: string, metrics: EvaluationRow["metrics_json"], analysis: EvaluationRow["analysis_json"], expectedEvaluationId: string | null) {
      const c = await execution.campaign(metrics.context.snapshot.campaign.id);
      if (c.status !== "closed") throw new EvaluationError("CLOSED_CAMPAIGN_REQUIRED");
      return privileged().rpc("record_campaign_evaluation_cas", { p_business_id: scope.businessId, p_campaign_id: c.id, p_expected_evaluation_id: expectedEvaluationId,
        p_blueprint_id: metrics.context.snapshot.blueprint?.id ?? "", p_evaluation_id: id, p_metrics: metrics, p_analysis: analysis,
        p_limitations: metrics.context.limitations, p_calculated_at: metrics.sourceFactsAt, p_actor_user_id: scope.ownerUserId });
    },
    async finalize(input: { campaignId: string; evaluationId: string; requestId: string; expectedCampaignVersion: number; expectedContextHash: string }) {
      const c = await execution.campaign(input.campaignId);
      return privileged().rpc("finalize_campaign_evaluation", { p_business_id: scope.businessId, p_campaign_id: c.id, p_preorder_id: c.preorder_id,
        p_evaluation_id: input.evaluationId, p_request_id: input.requestId, p_expected_campaign_version: input.expectedCampaignVersion,
        p_expected_context_hash: input.expectedContextHash, p_mode: "development_synthetic", p_actor_user_id: scope.ownerUserId });
    },
    async createCost(input: { campaignId: string; requestId: string; category: CampaignCost["category"]; description: string; amountIdr: number; incurredAt: string }) {
      await execution.campaign(input.campaignId);
      return z.array(CostSchema).length(1).parse(await privileged().insert("campaign_costs", { id: input.requestId, business_id: scope.businessId,
        campaign_id: input.campaignId, category: input.category, description: input.description, amount_idr: input.amountIdr, incurred_at: input.incurredAt }))[0];
    },
    async voidCost(entry: CampaignCost, at: string, reason: string) {
      await execution.campaign(entry.campaign_id);
      return z.array(CostSchema).max(1).parse(await privileged().update("campaign_costs", { id: `eq.${entry.id}`, business_id: `eq.${scope.businessId}`,
        campaign_id: `eq.${entry.campaign_id}`, version: `eq.${entry.version}`, voided_at: "is.null" }, { voided_at: at, void_reason: reason }));
    },
    async reviewCosts(campaignId: string, version: number) {
      await execution.campaign(campaignId);
      return z.array(z.object({ id: z.uuid() })).max(1).parse(await privileged().update("campaigns", { id: `eq.${campaignId}`, business_id: `eq.${scope.businessId}`,
        version: `eq.${version}`, status: "eq.closed" }, { costs_completeness: "confirmed_complete" }));
    },
  };
}
export type EvaluationRepository = ReturnType<typeof evaluationRepository>;
