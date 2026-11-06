import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { evaluationFixture, evaluationEnvironment } from "../fixtures/evaluation";
import { EvaluationRowSchema, EvaluationCommandSchema } from "../../src/features/campaign-evaluation/contracts";
import { calculateEvaluation } from "../../src/features/campaign-evaluation/calculate";
import { interpretEvaluation } from "../../src/features/campaign-evaluation/engine";
import { developmentEvaluationProvider } from "../../src/features/campaign-evaluation/development-provider";
import { buildEvaluationContext } from "../../src/features/campaign-evaluation/context";
import { evaluationCurrentHash, evaluationFinalization, evaluationHandoff } from "../../src/features/campaign-evaluation/service";
import { evaluationDatabaseError } from "../../src/features/campaign-evaluation/repository.server";
import { SupabaseError } from "../../src/lib/supabase/transport.server";

async function fixture(scenario = "exceeds_target") {
  const f = await evaluationFixture(scenario); const summary = calculateEvaluation(f.context); const owner = randomUUID();
  const analysis = await interpretEvaluation(f.context, summary, developmentEvaluationProvider("valid", evaluationEnvironment));
  const row = EvaluationRowSchema.parse({ id: randomUUID(), business_id: f.snapshot.campaign.business_id, campaign_id: f.snapshot.campaign.id,
    blueprint_id: f.snapshot.blueprint?.id, metrics_schema_version: 1, metrics_json: { schemaVersion: 1, context: f.context, summary,
      commandHash: "a".repeat(64), parentEvaluationId: null, sourceFactsAt: f.now, cas: { expectedEvaluationId: null } },
    analysis_json: { ...analysis, review: { status: "reviewed", reviewedByUserId: owner, reviewedAt: f.now } }, limitations_json: f.context.limitations,
    evaluation_kind: "provisional", calculated_at: f.now, evaluated_at: f.now, source_ai_generation_id: null });
  return { ...f, row, owner };
}
describe("evaluation CAS and simulated completion contracts", () => {
  it("requires the latest persisted, explicitly reviewed snapshot", async () => {
    const f = await fixture(); expect(evaluationFinalization(f.context, null, null).blockers).toContain("EVALUATION_REQUIRED");
    expect(evaluationFinalization(f.context, f.row, randomUUID()).eligible).toBe(false);
    f.row.analysis_json.review = { status: "unreviewed", reviewedByUserId: null, reviewedAt: null };
    expect(evaluationFinalization(f.context, f.row, f.row.id).blockers).toContain("OWNER_REVIEW_REQUIRED");
  });
  it("permits an incomplete manual checklist as a recorded limitation, without inventing a new completion prerequisite", async () => {
    const f = await fixture(); expect(f.row.metrics_json.summary.completedTasks).toBeLessThan(f.row.metrics_json.summary.totalTasks);
    expect(evaluationFinalization(f.context, f.row, f.row.id)).toMatchObject({ eligible: true, productionEligible: false, mode: "development_synthetic" });
  });
  it.each(["missing_cost", "provisional", "unavailable"])("rejects incomplete source %s", async (scenario) => {
    const f = await fixture(scenario); expect(evaluationFinalization(f.context, f.row, f.row.id).blockers).toContain("KPI_INCOMPLETE");
  });
  it("rejects stale facts and unreviewed spending", async () => {
    const f = await fixture(); f.input.costsCompleteness = "unreviewed"; const changed = buildEvaluationContext(f.input);
    expect(evaluationFinalization(changed, f.row, f.row.id).blockers).toEqual(expect.arrayContaining(["COSTS_INCOMPLETE", "STALE_SOURCE_STATE"]));
  });
  it("preserves sealed pre-completion facts and excludes completed synthetic evidence from production memory", async () => {
    const f = await fixture(); const request = randomUUID(); const c = f.context.snapshot.campaign;
    const row = EvaluationRowSchema.parse({ ...f.row, id: request, evaluation_kind: "final", metrics_json: { ...f.row.metrics_json, parentEvaluationId: f.row.id,
      finalization: { mode: "development_synthetic", requestId: request, reviewedEvaluationId: f.row.id, expectedCampaignVersion: c.version,
        completedCampaignVersion: c.version + 1, completedAt: f.now, actorUserId: f.owner, sourceContextHash: f.context.contextHash } } });
    const completed = buildEvaluationContext({ ...f.input, snapshot: { ...f.snapshot, campaign: { ...c, status: "completed", version: c.version + 1, completed_at: f.now } },
      analytics: f.context.analytics.status === "available" ? { ...f.context.analytics, data: { ...f.context.analytics.data, campaignVersion: c.version + 1 } } : f.context.analytics });
    const hash = evaluationCurrentHash(completed, row); expect(hash).toBe(f.context.contextHash);
    const handoff = evaluationHandoff(row, hash); expect(handoff).toMatchObject({ productionEligible: false, developmentEligible: true, finalizationState: "completed" });
    expect(handoff.exclusions).toEqual(["SYNTHETIC_EVALUATION"]);
    const changed = structuredClone(completed); changed.snapshot.preorder.version++;
    const refreshed = buildEvaluationContext({ ...changed, now: changed.calculatedAt });
    expect(evaluationCurrentHash(refreshed, row)).not.toBe(hash);
    expect(evaluationHandoff(row, evaluationCurrentHash(refreshed, row)).developmentEligible).toBe(false);
    row.metrics_json.finalization = { ...row.metrics_json.finalization!, actorUserId: randomUUID() };
    expect(() => evaluationHandoff(row, hash)).toThrow("INVALID_SNAPSHOT");
  });
  it("retains readable legacy Slice7 summaries while still rejecting tampered financial facts", async () => {
    const f = await fixture(); delete f.row.metrics_json.cas;
    f.row.metrics_json.summary.finalizationBlockers[0] = "FINALIZATION_DATABASE_CAPABILITY_MISSING";
    expect(evaluationHandoff(f.row, f.context.contextHash).productionEligible).toBe(false);
    f.row.metrics_json.summary.contributionIdr = 1;
    expect(() => evaluationHandoff(f.row, f.context.contextHash)).toThrow("INVALID_SNAPSHOT");
  });
  it("requires completion audit and validates the explicit latest token at runtime", async () => {
    const f = await fixture(); expect(EvaluationRowSchema.safeParse({ ...f.row, evaluation_kind: "final" }).success).toBe(false);
    expect(EvaluationCommandSchema.safeParse({ campaignId: f.row.campaign_id, requestId: randomUUID(), expectedCampaignVersion: 1,
      expectedEvaluationId: "invalid", expectedContextHash: "a".repeat(64), analyticsScenario: "exceeds_target", providerScenario: "valid" }).success).toBe(false);
  });
  it("maps named CAS conflicts separately from transient serialization failures", () => {
    expect(() => evaluationDatabaseError(new SupabaseError("40001", "STALE_SOURCE_STATE", 409))).toThrow("STALE_SOURCE_STATE");
    expect(() => evaluationDatabaseError(new SupabaseError("40001", "STALE_EVALUATION_VERSION", 409))).toThrow("STALE_EVALUATION_VERSION");
    try { evaluationDatabaseError(new SupabaseError("40001", "could not serialize access due to concurrent update", 409)); }
    catch (error) { expect(error).toMatchObject({ code: "DATABASE_BUSY", status: 503 }); }
  });
});
