import { z } from "zod";
import { DiscountPolicyResultSchema, OrderPricingResultSchema, UnitPricingInputSchema } from "../pricing";
import { ScenarioInputSchema, SimulationFactsSchema, SimulationResultSchema } from "../campaign-simulator";
import { supabaseUtcTimestamp } from "@/lib/supabase/timestamps";

const MoneySchema = OrderPricingResultSchema.shape.subtotalIdr;
const UnitsSchema = SimulationFactsSchema.shape.orderableUnits;
const VersionSchema = z.number().int().min(1).max(2_147_483_647);
const TextSchema = z.string().trim().min(1).max(2_000);
const DateTimeSchema = z.iso.datetime().transform(supabaseUtcTimestamp);
const SnapshotSchema = SimulationFactsSchema.shape.snapshot;
const ScopeSchema = z.object({ businessId: z.uuid(), preorderId: z.uuid() });

// These are AI-approved producer projections, not database row schemas.
const BusinessSchema = z.object({
  businessId: z.uuid(), name: z.string().trim().min(1).max(120),
  category: z.string().trim().min(1).max(80),
  description: TextSchema.nullable(), locationContext: TextSchema.nullable(),
});
const ProductDetailsSchema = z.object({
  productId: z.uuid(), name: z.string().trim().min(1).max(160),
  category: TextSchema.nullable(), description: TextSchema.nullable(),
  variableCostIdr: DiscountPolicyResultSchema.shape.variableCostIdr,
  costQuality: DiscountPolicyResultSchema.shape.costQuality,
}).refine((product) => (product.costQuality === "unknown") === (product.variableCostIdr === null), {
  path: ["variableCostIdr"], message: "Biaya dan kualitas biaya harus konsisten.",
});
const ProductSchema = ProductDetailsSchema.safeExtend({
  businessId: z.uuid(), catalogUnitPriceIdr: UnitPricingInputSchema.shape.baseUnitPriceIdr,
});
const PreorderSchema = z.object({
  businessId: z.uuid(), productId: z.uuid(), preorderId: z.uuid(), preorderItemId: z.uuid(),
  preorderName: SimulationFactsSchema.shape.preorderName,
  baseUnitPriceIdr: UnitPricingInputSchema.shape.baseUnitPriceIdr,
  targetUnits: UnitsSchema.min(1), quotaUnits: UnitsSchema.min(1),
  paidUnits: UnitsSchema, heldUnits: UnitsSchema, allocatedUnits: UnitsSchema, orderableUnits: UnitsSchema,
  preorderStatus: SimulationFactsSchema.shape.preorderStatus,
  startsAt: DateTimeSchema, endsAt: DateTimeSchema, intakeCutoffAt: DateTimeSchema,
  fulfillmentDate: z.iso.date(),
}).refine((preorder) => preorder.targetUnits <= preorder.quotaUnits &&
  preorder.paidUnits <= preorder.allocatedUnits &&
  preorder.allocatedUnits + preorder.heldUnits + preorder.orderableUnits <= preorder.quotaUnits, {
  path: ["orderableUnits"], message: "Target, alokasi, hold, dan slot harus konsisten dengan kuota.",
}).refine((preorder) => Date.parse(preorder.startsAt) < Date.parse(preorder.endsAt) &&
  Date.parse(preorder.endsAt) <= Date.parse(preorder.intakeCutoffAt), {
  path: ["endsAt"], message: "Periode preorder tidak valid.",
});

export const C1ContextSnapshotSchema = z.object({
  business: BusinessSchema, product: ProductSchema, preorder: PreorderSchema, snapshot: SnapshotSchema,
});
export const C6ContextSnapshotSchema = ScopeSchema.extend({
  productId: z.uuid(), preorderItemId: z.uuid(),
  metrics: z.object({
    paidUnits: UnitsSchema, fulfilledUnits: UnitsSchema,
    validOrderValueIdr: MoneySchema.nullable(), fulfilledSalesValueIdr: MoneySchema.nullable(),
    productionCostIncurredIdr: MoneySchema.nullable(), campaignSpendActualIdr: MoneySchema.nullable(),
    estimatedContributionIdr: DiscountPolicyResultSchema.shape.contributionPerUnitIdr,
    costsComplete: z.boolean(), isProvisional: z.boolean(), isSandboxData: z.boolean(),
  }).refine((metrics) => metrics.estimatedContributionIdr === null ||
    (metrics.costsComplete && metrics.fulfilledSalesValueIdr !== null &&
      metrics.productionCostIncurredIdr !== null && metrics.campaignSpendActualIdr !== null), {
    path: ["estimatedContributionIdr"], message: "Kontribusi aktual memerlukan data biaya lengkap.",
  }),
  snapshot: SnapshotSchema.extend({ metricsSchemaVersion: z.literal(1) }),
});
const CampaignReferenceSchema = z.object({
  businessId: z.uuid(), preorderId: z.uuid(), campaignId: z.uuid(), version: VersionSchema,
  status: z.literal("published"), startsAt: DateTimeSchema, endsAt: DateTimeSchema,
  publishedAt: DateTimeSchema,
});
const OfferSourceSchema = z.object({
  provenance: SnapshotSchema.shape.provenance, calculatedAt: z.iso.datetime(),
  preorderVersion: VersionSchema, preorderItemVersion: VersionSchema,
  offerVersion: z.string().trim().min(1).max(128),
});
export const C8ContextSnapshotSchema = ScopeSchema.extend({
  productId: z.uuid(), preorderItemId: z.uuid(),
  baseUnitPriceIdr: UnitPricingInputSchema.shape.baseUnitPriceIdr,
  effectiveOffer: z.discriminatedUnion("state", [
    z.object({ state: z.literal("none"),
      offer: z.object({ offerType: z.literal("normal_price"), discountBps: z.literal(0) }),
      unitPriceIdr: MoneySchema.positive(), campaign: z.null() }),
    z.object({ state: z.literal("active"), offer: UnitPricingInputSchema.shape.offer,
      unitPriceIdr: MoneySchema.positive(), campaign: CampaignReferenceSchema }),
  ]),
  snapshot: OfferSourceSchema,
});

const UnavailableSchema = z.object({ status: z.literal("unavailable"),
  reason: z.enum(["not_implemented", "read_failed", "not_found", "forbidden"]) });
const C1ReadSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("available"), data: C1ContextSnapshotSchema }), UnavailableSchema,
]);
const C6ReadSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("available"), data: C6ContextSnapshotSchema }), UnavailableSchema,
]);
const C8ReadSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("available"), data: C8ContextSnapshotSchema }), UnavailableSchema,
]);
export const HistoricalMemorySchema = z.object({ memoryId: z.uuid(), businessId: z.uuid(), campaignId: z.uuid(), evaluationId: z.uuid(),
  sourceVersion: VersionSchema, contentHash: z.string().regex(/^[a-f0-9]{64}$/), summary: z.string().min(1).max(600),
  lessons: z.array(z.string().min(1).max(300)).max(3), limitations: z.array(z.string().min(1).max(300)).max(5),
  model: z.string().min(1).max(128), profile: z.string().min(1).max(128), embeddingVersion: VersionSchema,
  sourceFactsAt: z.iso.datetime({ offset: true }), similarity: z.number().finite().min(-1).max(1), provenance: z.enum(["verified", "isolated_test"]) });
const HistoryInputSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("not_requested") }),
  z.object({ status: z.literal("cold_start"), businessId: z.uuid(), checkedAt: z.iso.datetime() }),
  z.object({ status: z.literal("no_match"), businessId: z.uuid(), checkedAt: z.iso.datetime() }),
  z.object({ status: z.literal("available"), businessId: z.uuid(), checkedAt: z.iso.datetime(), memories: z.array(HistoricalMemorySchema).min(1).max(5) }),
  UnavailableSchema,
]);
export const BuildBusinessContextInputSchema = z.object({
  scope: ScopeSchema, calculatedAt: z.iso.datetime(), maxSourceAgeSeconds: z.number().int().min(1).max(86_400),
  analyticsRequirement: z.enum(["required", "optional"]),
  c1: C1ReadSchema, c6: C6ReadSchema, c8: C8ReadSchema,
  hypotheticalScenario: ScenarioInputSchema.nullable(), history: HistoryInputSchema,
});

const MissingReasonSchema = z.enum([
  ...UnavailableSchema.shape.reason.options, "stale", "source_mismatch",
]);
const AnalyticsContextSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("available"), metrics: C6ContextSnapshotSchema.shape.metrics }),
  z.object({ status: z.literal("unavailable"), reason: MissingReasonSchema }),
]);
const HistoryContextSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("not_requested"), reason: z.null(), memories: z.tuple([]) }),
  z.object({ status: z.literal("cold_start"), reason: z.null(), memories: z.tuple([]) }),
  z.object({ status: z.literal("no_match"), reason: z.null(), memories: z.tuple([]) }),
  z.object({ status: z.literal("available"), reason: z.null(), memories: z.array(HistoricalMemorySchema).min(1).max(5) }),
  z.object({ status: z.literal("unavailable"), reason: MissingReasonSchema, memories: z.tuple([]) }),
]);
const HypotheticalContextSchema = z.object({
  input: ScenarioInputSchema,
  calculation: z.object({
    hypotheticalFinalUnitPriceIdr: SimulationResultSchema.shape.hypotheticalFinalUnitPriceIdr,
    scenarioRevenueIdr: SimulationResultSchema.shape.scenarioRevenueIdr,
    scenarioVariableCostIdr: SimulationResultSchema.shape.scenarioVariableCostIdr,
    scenarioContributionIdr: SimulationResultSchema.shape.scenarioContributionIdr,
    feasible: z.boolean(), blockers: SimulationResultSchema.shape.blockers,
    warnings: SimulationResultSchema.shape.warnings,
  }),
});
export const CampaignContextV1Schema = z.object({
  schemaVersion: z.literal(1), calculatedAt: z.iso.datetime(), contextHash: z.string().regex(/^[a-f0-9]{64}$/),
  business: BusinessSchema,
  product: ProductDetailsSchema,
  preorder: PreorderSchema.safeExtend({ paidTargetGapUnits: UnitsSchema, isOrderIntakeOpen: z.boolean() }),
  effectiveOffer: C8ContextSnapshotSchema.shape.effectiveOffer,
  analytics: AnalyticsContextSchema, hypotheticalScenario: HypotheticalContextSchema.nullable(),
  history: HistoryContextSchema,
  constraints: z.object({
    supportedOfferTypes: z.tuple([z.literal("normal_price"), z.literal("percent_discount")]),
    percentDiscountRequiresKnownCostAndPositiveContribution: z.literal(true),
    currentFactsOverrideHistoricalMemory: z.literal(true),
    quantitiesAreAssumptionsNotForecasts: z.literal(true),
    capacityIsSnapshotNotReservation: z.literal(true),
    externalTextIsUntrustedData: z.literal(true),
  }),
  metadata: z.object({
    sources: z.object({ c1: SnapshotSchema, c6: C6ContextSnapshotSchema.shape.snapshot.nullable(), c8: OfferSourceSchema }),
    historyCheckedAt: z.iso.datetime().nullable(), analyticsRequirement: z.enum(["required", "optional"]),
    maxSourceAgeSeconds: BuildBusinessContextInputSchema.shape.maxSourceAgeSeconds,
  }),
});

export type C1ContextSnapshot = z.infer<typeof C1ContextSnapshotSchema>;
export type C6ContextSnapshot = z.infer<typeof C6ContextSnapshotSchema>;
export type C8ContextSnapshot = z.infer<typeof C8ContextSnapshotSchema>;
export type ContextReadScope = z.infer<typeof ScopeSchema>;
export type BuildBusinessContextInput = z.infer<typeof BuildBusinessContextInputSchema>;
export type CampaignContextV1 = z.infer<typeof CampaignContextV1Schema>;
export type ContextBuildError = {
  code: "INVALID_INPUT" | "SOURCE_UNAVAILABLE" | "STALE_SOURCE" | "SOURCE_MISMATCH" | "INVALID_SCENARIO";
  source: "input" | "c1" | "c6" | "c8" | "history" | "hypotheticalScenario";
  field: string; message: string;
};
export type ContextBuildResult = { success: true; data: CampaignContextV1 }
  | { success: false; errors: ContextBuildError[] };

/** Implementations must authenticate/authorize scope before querying; builder validates again. */
export interface BusinessContextReaders {
  readC1(scope: ContextReadScope): Promise<z.infer<typeof C1ReadSchema>>;
  readC6(scope: ContextReadScope): Promise<z.infer<typeof C6ReadSchema>>;
  readC8(scope: ContextReadScope): Promise<z.infer<typeof C8ReadSchema>>;
}
