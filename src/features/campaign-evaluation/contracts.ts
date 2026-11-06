import { z } from "zod";
import { ExecutionSnapshotSchema, LifecycleCampaignSchema, PublicationBaselineSchema } from "../campaign-execution/contracts";
const Time = z.iso.datetime({ offset: true });
const Version = z.number().int().positive().max(2_147_483_647);
export const Money = z.number().int().min(0).max(1_000_000_000);
const Units = z.number().int().min(0).max(2_147_483_647);
const Text = z.string().trim().min(1).max(600);
export const CostSchema = z.object({ id: z.uuid(), business_id: z.uuid(), campaign_id: z.uuid(), category: z.enum(["advertising", "printing", "other"]),
  description: z.string().max(500).nullable(), amount_idr: Money, incurred_at: Time, voided_at: Time.nullable(), void_reason: z.string().max(500).nullable(), version: Version })
  .refine((cost) => (cost.voided_at === null) === (cost.void_reason === null), "Void timestamp/reason must agree");
export type CampaignCost = z.infer<typeof CostSchema>;
export const AnalyticsScenarioSchema = z.enum(["exceeds_target", "below_target", "high_spend", "incomplete_checklist", "missing_cost", "provisional", "unavailable"]);
export const EvaluationProviderScenarioSchema = z.enum(["valid", "failure", "invalid"]);
export const CampaignMetricsSchema = z.strictObject({ currentPreorderPaidUnits: Units.nullable(), paidUnitsInWindow: Units.nullable(),
  attributedPaidUnits: Units.nullable(), attributedPaidUnitsLifetime: Units.nullable(), discountedPaidUnits: Units.nullable(),
  scopedFulfilledSalesValueIdr: Money.nullable(), scopedProductionCostIncurredIdr: Money.nullable(),
  discountValueAppliedIdr: Money.nullable() });
export const CampaignAnalyticsSnapshotSchema = z.strictObject({ schemaVersion: z.literal(1), businessId: z.uuid(), preorderId: z.uuid(), campaignId: z.uuid(),
  sourceId: z.string().min(1).max(128), sourceVersion: Version, campaignVersion: Version, calculatedAt: Time,
  provenance: z.enum(["authoritative", "sandbox", "development_fixture"]), isProvisional: z.boolean(), costsComplete: z.boolean(), operationallyResolved: z.boolean().nullable(),
  window: z.strictObject({ startsAt: Time, endsAt: Time }), financialScope: z.literal("distinct_union_attribution_or_pricing"),
  financialScopeOrderIds: z.array(z.uuid()).max(10000).nullable(), metrics: CampaignMetricsSchema,
}).superRefine((data, ctx) => {
  if (Date.parse(data.window.startsAt) > Date.parse(data.window.endsAt) || (data.provenance === "development_fixture" && (!data.isProvisional || data.financialScopeOrderIds !== null))) ctx.addIssue({ code: "custom", message: "Invalid analytics provenance/window" });
  const m = data.metrics;
  if (m.attributedPaidUnits !== null && m.paidUnitsInWindow !== null && m.attributedPaidUnits > m.paidUnitsInWindow) ctx.addIssue({ code: "custom", message: "Attributed window exceeds measurement window" });
  if (data.financialScopeOrderIds !== null && new Set(data.financialScopeOrderIds).size !== data.financialScopeOrderIds.length) ctx.addIssue({ code: "custom", message: "Financial scope must contain distinct order identifiers" });
});
export const AnalyticsReadSchema = z.discriminatedUnion("status", [z.object({ status: z.literal("available"), data: CampaignAnalyticsSnapshotSchema }),
  z.object({ status: z.literal("unavailable"), reason: z.enum(["not_implemented", "read_failed"]) })]);
export type AnalyticsRead = z.infer<typeof AnalyticsReadSchema>;
export const EvaluationContextSchema = z.object({ schemaVersion: z.literal(1), snapshot: ExecutionSnapshotSchema.extend({ campaign: LifecycleCampaignSchema.extend({ baseline_json: PublicationBaselineSchema }) }), costs: z.array(CostSchema).max(100),
  costsCompleteness: z.enum(["unreviewed", "confirmed_complete"]), analytics: AnalyticsReadSchema, calculatedAt: Time, contextHash: z.string().regex(/^[a-f0-9]{64}$/),
  analyticsScenario: AnalyticsScenarioSchema, references: z.array(z.enum(["campaign", "blueprint", "baseline", "execution", "costs", "c6"])), limitations: z.array(Text).min(1).max(20) });
export type EvaluationContext = z.infer<typeof EvaluationContextSchema>;
export const EvaluationSummarySchema = z.object({ baselinePaidUnits: Units, plannedAdditionalUnits: Units, hypotheticalRevenueIdr: Money, hypotheticalContributionIdr: z.number().int().nullable(),
  observed: CampaignMetricsSchema, recordedSpendSubtotalIdr: Money, actualPromotionSpendIdr: Money.nullable(), budgetCapIdr: Money,
  budgetVarianceIdr: z.number().int().min(-1_000_000_000).max(1_000_000_000).nullable(), contributionIdr: z.number().int().min(-1_000_000_000).max(1_000_000_000).nullable(),
  achievementBps: z.number().int().nonnegative().nullable(), observedMinusTargetUnits: z.number().int().nullable(),
  completedTasks: Units, totalTasks: Units, executionBps: z.number().int().min(0).max(10000),
  synthetic: z.boolean(), provisional: z.boolean(), costsComplete: z.boolean(), finalizationEligible: z.literal(false), finalizationBlockers: z.array(z.string()).min(1),
});
export type EvaluationSummary = z.infer<typeof EvaluationSummarySchema>;
export const EvaluationNarrativeSchema = z.strictObject({ outcome: z.enum(["above_target", "below_target", "unknown"]), financialState: z.enum(["positive", "nonpositive", "unknown"]), executionState: z.enum(["complete", "incomplete"]),
  summary: Text, kpiAnalysis: Text, financialAnalysis: Text, executionAnalysis: Text,
  successes: z.array(Text).min(1).max(5), shortfalls: z.array(Text).min(1).max(5), risks: z.array(Text).min(1).max(5), recommendations: z.array(Text).min(1).max(5),
  evidenceReferences: z.array(z.enum(["campaign", "blueprint", "baseline", "execution", "costs", "c6"])).min(1).max(6), warnings: z.array(Text).min(1).max(8) });
export type EvaluationNarrative = z.infer<typeof EvaluationNarrativeSchema>;
export type EvaluationProvider = ({ kind?: undefined } | { kind: "gemini"; model: string }) & { generate(input: { summary: EvaluationSummary; references: EvaluationContext["references"] }, metadata?: { requestId: string | null }): Promise<unknown> };
export const AnalysisSchema = z.object({ schemaVersion: z.literal(1), provider: z.enum(["development-fake-evaluation", "gemini"]), model: z.string().regex(/^gemini-[a-zA-Z0-9.-]{1,100}$/).optional(),
  providerRequestId: z.string().min(1).max(256).nullable().optional(), generatedAt: Time.optional(), synthetic: z.literal(true),
  status: z.enum(["available", "failed", "invalid"]), narrative: EvaluationNarrativeSchema.nullable(),
  review: z.object({ status: z.enum(["unreviewed", "reviewed"]), reviewedByUserId: z.uuid().nullable(), reviewedAt: Time.nullable() }) })
  .refine(a => a.provider === "gemini" ? a.model !== undefined && a.providerRequestId !== undefined && a.generatedAt !== undefined
    : a.model === undefined && a.providerRequestId === undefined && a.generatedAt === undefined, "Provider provenance must match its source")
  .refine((analysis) => (analysis.status === "available") === (analysis.narrative !== null), "Provider status/narrative must agree")
  .refine((analysis) => analysis.review.status === "reviewed" ? analysis.review.reviewedByUserId !== null && analysis.review.reviewedAt !== null
    : analysis.review.reviewedByUserId === null && analysis.review.reviewedAt === null, "Owner review audit required");
export const FinalizationAuditSchema = z.object({ mode: z.literal("development_synthetic"), requestId: z.uuid(), reviewedEvaluationId: z.uuid(),
  expectedCampaignVersion: Version, completedCampaignVersion: Version, completedAt: Time, actorUserId: z.uuid(), sourceContextHash: z.string().regex(/^[a-f0-9]{64}$/) });
export const MetricsEnvelopeSchema = z.object({ schemaVersion: z.literal(1), context: EvaluationContextSchema, summary: EvaluationSummarySchema,
  commandHash: z.string().regex(/^[a-f0-9]{64}$/), parentEvaluationId: z.uuid().nullable(), sourceFactsAt: Time,
  cas: z.object({ expectedEvaluationId: z.uuid().nullable() }).optional(), finalization: FinalizationAuditSchema.optional() });
export const EvaluationRowSchema = z.object({ id: z.uuid(), business_id: z.uuid(), campaign_id: z.uuid(), blueprint_id: z.uuid(), metrics_schema_version: z.literal(1),
  metrics_json: MetricsEnvelopeSchema, analysis_json: AnalysisSchema, limitations_json: z.array(Text), evaluation_kind: z.enum(["provisional", "final"]),
  calculated_at: Time, evaluated_at: Time, source_ai_generation_id: z.uuid().nullable() })
  .refine((row) => (row.evaluation_kind === "final") === (row.metrics_json.finalization !== undefined), "Final evaluation requires completion audit");
export type EvaluationRow = z.infer<typeof EvaluationRowSchema>;
export const EvaluationCommandSchema = z.strictObject({ campaignId: z.uuid(), requestId: z.uuid(), expectedCampaignVersion: Version, expectedEvaluationId: z.uuid().nullable().default(null), expectedContextHash: z.string().regex(/^[a-f0-9]{64}$/),
  analyticsScenario: AnalyticsScenarioSchema, providerScenario: EvaluationProviderScenarioSchema });
export const EvaluationReviewCommandSchema = z.strictObject({ campaignId: z.uuid(), requestId: z.uuid(), evaluationId: z.uuid(), expectedCampaignVersion: Version,
  expectedContextHash: z.string().regex(/^[a-f0-9]{64}$/), confirm: z.literal(true) });
export const CostCreateCommandSchema = z.strictObject({ campaignId: z.uuid(), requestId: z.uuid(), category: CostSchema.shape.category,
  description: z.string().trim().min(1).max(500), amountIdr: Money, incurredAt: Time });
export const CostVoidCommandSchema = z.strictObject({ campaignId: z.uuid(), costId: z.uuid(), expectedCostVersion: Version, reason: z.string().trim().min(1).max(500) });
export const CostReviewCommandSchema = z.strictObject({ campaignId: z.uuid(), expectedCampaignVersion: Version, confirm: z.literal(true) });
export const FinalizeCommandSchema = EvaluationReviewCommandSchema;
export const EvaluationViewSchema = z.object({ context: EvaluationContextSchema, summary: EvaluationSummarySchema,
  measurementWindow: z.object({ startsAt: Time, endsAt: Time }),
  history: z.array(z.object({ row: EvaluationRowSchema, stale: z.boolean(), memoryExclusions: z.array(z.string()) })), unsupportedCount: z.number().int().nonnegative(),
  latestEvaluationId: z.uuid().nullable(), finalization: z.object({ eligible: z.boolean(), productionEligible: z.literal(false), mode: z.literal("development_synthetic"),
    code: z.string().nullable(), blockers: z.array(z.string()), evaluationId: z.uuid().nullable() }), synthetic: z.literal(true), replayed: z.boolean().optional() });
export type EvaluationView = z.infer<typeof EvaluationViewSchema>;
export class EvaluationError extends Error { constructor(readonly code: string, readonly status = 409) { super(code); } }
