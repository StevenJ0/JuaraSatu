import { PublicationBaselineSchema } from "../campaign-execution/contracts";
import { CampaignMetricsSchema, EvaluationContextSchema, EvaluationError, EvaluationSummarySchema, Money, type EvaluationContext, type EvaluationSummary } from "./contracts";

function bounded(value: bigint) {
  if (value < BigInt(-1_000_000_000) || value > BigInt(1_000_000_000)) throw new EvaluationError("NUMERIC_RANGE", 400);
  return Number(value);
}
export function calculateEvaluation(raw: EvaluationContext) {
  const c = EvaluationContextSchema.parse(raw); const bp = c.snapshot.blueprint;
  if (!bp) throw new EvaluationError("INVALID_EXECUTION_PLAN");
  const planned = bp.blueprint_json;
  const subtotal = Money.parse(bounded(c.costs.filter((cost) => cost.voided_at === null).reduce((sum, cost) => sum + BigInt(cost.amount_idr), BigInt(0))));
  const spend = c.costsCompleteness === "confirmed_complete" ? subtotal : null;
  const analytics = c.analytics.status === "available" ? c.analytics.data : null;
  const observed = analytics?.metrics ?? CampaignMetricsSchema.parse({ currentPreorderPaidUnits: null, paidUnitsInWindow: null, attributedPaidUnits: null,
    attributedPaidUnitsLifetime: null, discountedPaidUnits: null, scopedFulfilledSalesValueIdr: null, scopedProductionCostIncurredIdr: null, discountValueAppliedIdr: null });
  const costsComplete = spend !== null && analytics?.costsComplete === true && observed.scopedProductionCostIncurredIdr !== null;
  const contribution = costsComplete && observed.scopedFulfilledSalesValueIdr !== null && observed.scopedProductionCostIncurredIdr !== null && spend !== null
    ? bounded(BigInt(observed.scopedFulfilledSalesValueIdr) - BigInt(observed.scopedProductionCostIncurredIdr) - BigInt(spend)) : null;
  const total = c.snapshot.tasks.length; const complete = c.snapshot.tasks.filter((task) => task.completed_at !== null).length;
  const blockers = ["VERIFIED_C6_UNAVAILABLE"];
  if (!analytics || analytics.provenance === "development_fixture") blockers.push("AUTHORITATIVE_C6_REQUIRED");
  if (!analytics || analytics.isProvisional || analytics.operationallyResolved !== true) blockers.push("OPERATIONAL_COMPLETENESS_REQUIRED");
  if (!costsComplete) blockers.push("COSTS_INCOMPLETE");
  return EvaluationSummarySchema.parse({ baselinePaidUnits: PublicationBaselineSchema.parse(c.snapshot.campaign.baseline_json).baseline_preorder_paid_units,
    plannedAdditionalUnits: planned.targetAdditionalUnits, hypotheticalRevenueIdr: planned.financial.calculation.scenarioRevenueIdr,
    hypotheticalContributionIdr: planned.financial.calculation.scenarioContributionIdr, observed, recordedSpendSubtotalIdr: subtotal, actualPromotionSpendIdr: spend,
    budgetCapIdr: planned.budgetCapIdr, budgetVarianceIdr: spend === null ? null : bounded(BigInt(spend) - BigInt(planned.budgetCapIdr)), contributionIdr: contribution,
    achievementBps: observed.paidUnitsInWindow === null ? null : Number(BigInt(observed.paidUnitsInWindow) * BigInt(10000) / BigInt(planned.targetAdditionalUnits)),
    observedMinusTargetUnits: observed.paidUnitsInWindow === null ? null : observed.paidUnitsInWindow - planned.targetAdditionalUnits,
    completedTasks: complete, totalTasks: total, executionBps: total ? Math.floor(complete * 10000 / total) : 0,
    synthetic: analytics?.provenance === "development_fixture", provisional: true, costsComplete, finalizationEligible: false, finalizationBlockers: blockers });
}
export function evaluationAssessments(s: EvaluationSummary) {
  return { outcome: s.achievementBps === null ? "unknown" as const : s.achievementBps >= 10000 ? "above_target" as const : "below_target" as const,
    financialState: s.contributionIdr === null ? "unknown" as const : s.contributionIdr > 0 ? "positive" as const : "nonpositive" as const,
    executionState: s.executionBps === 10000 ? "complete" as const : "incomplete" as const };
}
