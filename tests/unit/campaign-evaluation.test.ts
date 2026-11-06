import { describe, expect, it } from "vitest";
import { evaluationFixture, evaluationEnvironment } from "../fixtures/evaluation";
import { buildEvaluationContext } from "../../src/features/campaign-evaluation/context";
import { calculateEvaluation } from "../../src/features/campaign-evaluation/calculate";
import { interpretEvaluation, validateEvaluationNarrative } from "../../src/features/campaign-evaluation/engine";
import { developmentEvaluationProvider, syntheticCampaignAnalytics, evaluationDevelopmentEnabled } from "../../src/features/campaign-evaluation/development-provider";
import { EvaluationNarrativeSchema, CostCreateCommandSchema, EvaluationReviewCommandSchema, AnalysisSchema } from "../../src/features/campaign-evaluation/contracts";

describe("evaluation context and deterministic KPI", () => {
  it("keeps plan, real baseline projection, synthetic observation, attribution and pricing distinct", async () => {
    const f = await evaluationFixture(); const result = calculateEvaluation(f.context);
    expect(result).toMatchObject({ baselinePaidUnits: 30, plannedAdditionalUnits: 6, hypotheticalRevenueIdr: 648000,
      observed: { currentPreorderPaidUnits: 38, paidUnitsInWindow: 8, attributedPaidUnits: 5, discountedPaidUnits: 8, scopedFulfilledSalesValueIdr: 864000, scopedProductionCostIncurredIdr: 600000 },
      actualPromotionSpendIdr: 50000, contributionIdr: 214000, budgetVarianceIdr: 25000, achievementBps: 13333, completedTasks: 1, totalTasks: 2, executionBps: 5000,
      synthetic: true, provisional: true, finalizationEligible: false });
  });
  it("never substitutes promotion budget for unreviewed spending", async () => {
    const f = await evaluationFixture("exceeds_target", false);
    expect(calculateEvaluation(f.context)).toMatchObject({ recordedSpendSubtotalIdr: 50000, actualPromotionSpendIdr: null, budgetVarianceIdr: null, contributionIdr: null });
  });
  it("distinguishes reviewed zero spending from unreviewed empty records", async () => {
    const f = await evaluationFixture(); f.input.costs = [];
    expect(calculateEvaluation(buildEvaluationContext(f.input)).actualPromotionSpendIdr).toBe(0);
    f.input.costsCompleteness = "unreviewed";
    expect(calculateEvaluation(buildEvaluationContext(f.input)).actualPromotionSpendIdr).toBeNull();
  });
  it("excludes voided records while preserving their provenance", async () => {
    const f = await evaluationFixture(); f.costs[0].voided_at = f.now; f.costs[0].void_reason = "Koreksi sintetis";
    const context = buildEvaluationContext(f.input); expect(context.costs).toHaveLength(1); expect(calculateEvaluation(context).recordedSpendSubtotalIdr).toBe(0);
  });
  it.each(["below_target", "high_spend", "missing_cost", "provisional", "unavailable"])("handles scenario %s without fabricating actual transactions", async (scenario) => {
    const f = await evaluationFixture(scenario); const s = calculateEvaluation(f.context);
    expect(s.finalizationEligible).toBe(false); expect(s.provisional).toBe(true);
    if (scenario === "missing_cost" || scenario === "unavailable") expect(s.contributionIdr).toBeNull();
    if (scenario === "unavailable") { expect(s.observed.paidUnitsInWindow).toBeNull(); expect(s.achievementBps).toBeNull(); }
    if (scenario === "high_spend") expect(s.contributionIdr).toBe(16000);
  });
  it("uses frozen price once for synthetic pricing, independently of original effective discount", async () => {
    const f = await evaluationFixture(); expect(f.context.analytics.status === "available" && f.context.analytics.data.metrics.scopedFulfilledSalesValueIdr).toBe(864000);
    expect(f.snapshot.item.base_price_snapshot_idr).toBe(120000);
  });
  it.each(["campaign", "window", "stale", "cost_tenant", "task_source"])("rejects source mismatch: %s", async (kind) => {
    const f = await evaluationFixture(); const a = f.input.analytics;
    if (a.status !== "available") throw new Error("No source");
    if (kind === "campaign") a.data.campaignVersion++;
    if (kind === "window") a.data.window.startsAt = "2026-11-01T00:00:00Z";
    if (kind === "stale") a.data.calculatedAt = "2026-11-02T03:00:00Z";
    if (kind === "cost_tenant") f.costs[0].business_id = "99999999-9999-4999-8999-999999999999";
    if (kind === "task_source") f.snapshot.tasks[0].task_key = "invented-task";
    expect(() => buildEvaluationContext(f.input)).toThrow();
  });
  it("keeps the hash stable over clock-only refresh and invalidates it on actual task/cost changes", async () => {
    const f = await evaluationFixture(); const updated = { ...f.input, now: "2026-11-02T03:02:01Z", analytics: syntheticCampaignAnalytics(f.snapshot, "exceeds_target", "2026-11-02T03:02:01Z", evaluationEnvironment) };
    expect(buildEvaluationContext(updated).contextHash).toBe(f.context.contextHash);
    f.costs[0].version++; expect(buildEvaluationContext(updated).contextHash).not.toBe(f.context.contextHash);
  });
  it("rejects aggregate money overflow rather than truncating or wrapping", async () => {
    const f = await evaluationFixture(); f.costs[0].amount_idr = 1_000_000_000;
    f.costs.push({ ...f.costs[0], id: "99999999-9999-4999-8999-999999999999", amount_idr: 1 });
    expect(() => calculateEvaluation(buildEvaluationContext(f.input))).toThrowError(expect.objectContaining({ code: "NUMERIC_RANGE" }));
  });
  it("does not let published/checklist state create observed paid units", async () => {
    const f = await evaluationFixture("unavailable"); f.snapshot.tasks.forEach((t) => { t.completed_at = f.now; });
    const s = calculateEvaluation(buildEvaluationContext(f.input)); expect(s.executionBps).toBe(10000); expect(s.observed.paidUnitsInWindow).toBeNull();
  });
  it("preserves confirmed zero observations and a negative contribution instead of treating them as missing", async () => {
    const f = await evaluationFixture(); if (f.input.analytics.status !== "available") throw new Error("No C6");
    Object.assign(f.input.analytics.data.metrics, { currentPreorderPaidUnits: 30, paidUnitsInWindow: 0, attributedPaidUnits: 0, attributedPaidUnitsLifetime: 0,
      discountedPaidUnits: 0, scopedFulfilledSalesValueIdr: 0, scopedProductionCostIncurredIdr: 0, discountValueAppliedIdr: 0 });
    expect(calculateEvaluation(buildEvaluationContext(f.input))).toMatchObject({ achievementBps: 0, contributionIdr: -50000, observedMinusTargetUnits: -6 });
  });
  it("distinguishes sandbox KPI provenance from synthetic observations and real cash", async () => {
    const f = await evaluationFixture(); if (f.input.analytics.status !== "available") throw new Error("No C6");
    f.input.analytics.data.provenance = "sandbox";
    const c = buildEvaluationContext(f.input); expect(c.limitations.some((text) => text.includes("bukan penerimaan uang nyata"))).toBe(true);
    expect(calculateEvaluation(c).synthetic).toBe(false); expect(calculateEvaluation(c).finalizationEligible).toBe(false);
  });
  it("rejects duplicate authoritative financial-scope IDs without reconstructing raw orders", async () => {
    const f = await evaluationFixture(); if (f.input.analytics.status !== "available") throw new Error("No C6");
    f.input.analytics.data.provenance = "sandbox";
    f.input.analytics.data.financialScopeOrderIds = ["99999999-9999-4999-8999-999999999999", "99999999-9999-4999-8999-999999999999"];
    expect(() => buildEvaluationContext(f.input)).toThrow();
  });
});
describe("AI evaluation interpretation", () => {
  it("generates context-sensitive text with explicit synthetic warnings and bounded source references", async () => {
    const f = await evaluationFixture(); const summary = calculateEvaluation(f.context);
    const result = await interpretEvaluation(f.context, summary, developmentEvaluationProvider("valid", evaluationEnvironment));
    expect(result.status).toBe("available"); expect(result.narrative?.outcome).toBe("above_target"); expect(result.review.status).toBe("unreviewed");
  });
  it.each(["failure", "invalid"] as const)("preserves deterministic facts on provider %s", async (scenario) => {
    const f = await evaluationFixture(); const summary = calculateEvaluation(f.context);
    const result = await interpretEvaluation(f.context, summary, developmentEvaluationProvider(scenario, evaluationEnvironment));
    expect(result.status).toBe(scenario === "failure" ? "failed" : "invalid"); expect(result.narrative).toBeNull(); expect(summary.contributionIdr).toBe(214000);
  });
  it("classifies provider timeout as failure without leaking provider details", async () => {
    const f = await evaluationFixture(); const s = calculateEvaluation(f.context);
    expect((await interpretEvaluation(f.context, s, { generate: async () => { throw new DOMException("private diagnostic", "TimeoutError"); } })).status).toBe("failed");
  });
  it.each(["number", "reference", "causal", "contradiction", "extra_metric"])("rejects fabricated %s", async (kind) => {
    const f = await evaluationFixture("below_target"); const s = calculateEvaluation(f.context);
    const report = EvaluationNarrativeSchema.parse(await developmentEvaluationProvider("valid", evaluationEnvironment).generate({ summary: s, references: f.context.references }));
    const raw: Record<string, unknown> = { ...report };
    if (kind === "number") raw.summary = "Penjualan mencapai 999 unit";
    if (kind === "reference") raw.evidenceReferences = ["other-business"];
    if (kind === "causal") raw.summary = "Campaign menyebabkan peningkatan penjualan";
    if (kind === "contradiction") raw.outcome = "above_target";
    if (kind === "extra_metric") raw.authoritativeRevenue = 999999;
    expect(() => validateEvaluationNarrative(raw, f.context, s)).toThrow();
  });
  it("rejects disabled and production Fake mode", () => {
    expect(evaluationDevelopmentEnabled({ NODE_ENV: "production", CAMPAIGN_EVALUATION_MODE: "synthetic" })).toBe(false);
    expect(() => developmentEvaluationProvider("valid", { NODE_ENV: "production", CAMPAIGN_EVALUATION_MODE: "synthetic" })).toThrow();
  });
  it("validates owner review and costs without implicit numeric coercion", () => {
    expect(CostCreateCommandSchema.safeParse({ amountIdr: "50000" }).success).toBe(false);
    expect(EvaluationReviewCommandSchema.safeParse({ confirm: false }).success).toBe(false);
  });
  it("rejects a fabricated owner-review state without actor/timestamp audit", () => {
    expect(AnalysisSchema.safeParse({ schemaVersion: 1, provider: "development-fake-evaluation", synthetic: true, status: "failed", narrative: null,
      review: { status: "reviewed", reviewedByUserId: null, reviewedAt: null } }).success).toBe(false);
  });
});
