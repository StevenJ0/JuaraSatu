import { z } from "zod";
import {
  DiscountPolicyResultSchema,
  OrderPricingResultSchema,
  PricingErrorSchema,
  UnitPricingInputSchema,
} from "../pricing";

const MoneySchema = OrderPricingResultSchema.shape.subtotalIdr;
const SignedMoneySchema = z.number().int().refine(
  (value) => MoneySchema.safeParse(Math.abs(value)).success,
  "Kontribusi harus berada di antara -Rp1 miliar dan Rp1 miliar.",
);
const OfferSchema = UnitPricingInputSchema.shape.offer;

const SnapshotSchema = z.strictObject({
  provenance: z.enum(["development_fixture", "server"]),
  calculatedAt: z.iso.datetime(),
  preorderVersion: z.number().int().positive(),
  preorderItemVersion: z.number().int().positive(),
  capacityVersion: z.number().int().positive(),
  productVersion: z.number().int().positive(),
});

const CurrentOfferSchema = z.strictObject({
  preorderId: z.uuid(),
  preorderItemId: z.uuid(),
  preorderItemVersion: z.number().int().positive(),
  offer: OfferSchema,
  unitPriceIdr: MoneySchema.positive(),
  offerVersion: z.string().min(1).max(128),
  calculatedAt: z.iso.datetime(),
});

export const SimulationFactsSchema = z.strictObject({
  businessId: z.uuid(),
  preorderId: z.uuid(),
  preorderItemId: z.uuid(),
  preorderName: z.string().trim().min(1).max(160),
  productName: z.string().trim().min(1).max(160),
  preorderStatus: z.enum(["draft", "published", "closed", "completed", "cancelled"]),
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  intakeCutoffAt: z.iso.datetime(),
  baseUnitPriceIdr: UnitPricingInputSchema.shape.baseUnitPriceIdr,
  variableCostIdr: DiscountPolicyResultSchema.shape.variableCostIdr,
  costQuality: DiscountPolicyResultSchema.shape.costQuality,
  orderableUnits: z.number().int().min(0).max(2_147_483_647),
  currentOffer: CurrentOfferSchema.nullable(),
  snapshot: SnapshotSchema,
}).refine(
  (facts) => (facts.costQuality === "unknown") === (facts.variableCostIdr === null),
  { path: ["variableCostIdr"], message: "Biaya dan cost quality tidak konsisten." },
).refine(
  (facts) => Date.parse(facts.startsAt) < Date.parse(facts.endsAt) &&
    Date.parse(facts.endsAt) <= Date.parse(facts.intakeCutoffAt),
  { path: ["endsAt"], message: "Periode preorder harus valid dan tidak melampaui cutoff." },
);

export const ScenarioInputSchema = z.strictObject({
  offer: OfferSchema,
  assumedAdditionalUnits: z.number().int().min(0).max(10_000),
  assumedPromotionCostIdr: MoneySchema,
});

export const ScenarioComparisonInputSchema = z.array(ScenarioInputSchema).min(2).max(3);

export const SimulationMessageSchema = PricingErrorSchema.extend({
  code: z.enum([
    ...PricingErrorSchema.shape.code.options,
    "COST_ESTIMATED", "CAPACITY_EXCEEDED", "PREORDER_NOT_OPEN",
    "SOURCE_MISMATCH", "CURRENT_OFFER_UNAVAILABLE", "NONPOSITIVE_SCENARIO",
    "DIFFERENT_ASSUMPTIONS",
  ]),
});

export const SimulationResultSchema = z.strictObject({
  schemaVersion: z.literal(1),
  businessId: z.uuid(),
  preorderId: z.uuid(),
  preorderItemId: z.uuid(),
  frozenBaseUnitPriceIdr: UnitPricingInputSchema.shape.baseUnitPriceIdr,
  currentOffer: CurrentOfferSchema.nullable(),
  hypotheticalOffer: OfferSchema,
  hypotheticalFinalUnitPriceIdr: MoneySchema.positive(),
  discountPerUnitIdr: MoneySchema,
  contributionPerUnitIdr: SignedMoneySchema.nullable(),
  assumedAdditionalUnits: ScenarioInputSchema.shape.assumedAdditionalUnits,
  assumedPromotionCostIdr: MoneySchema,
  scenarioRevenueIdr: MoneySchema,
  scenarioVariableCostIdr: MoneySchema.nullable(),
  scenarioContributionIdr: SignedMoneySchema.nullable(),
  feasible: z.boolean(),
  warnings: z.array(SimulationMessageSchema),
  blockers: z.array(SimulationMessageSchema),
  assumptions: z.array(z.string()),
  snapshot: SnapshotSchema,
});

export const ScenarioComparisonResultSchema = z.strictObject({
  scenarios: z.array(SimulationResultSchema).min(2).max(3),
  warnings: z.array(SimulationMessageSchema),
});

const PercentTextSchema = z.string().trim().regex(
  /^\d{1,2}(?:[.,]\d{1,2})?$/,
  "Isi diskon 0–99,99%, maksimal dua angka desimal.",
).transform((text) => {
  const [whole, fraction = ""] = text.replace(",", ".").split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
});
const IntegerTextSchema = z.string().trim().max(16).regex(
  /^\d+$/, "Isi bilangan bulat tanpa tanda, desimal, atau pemisah ribuan.",
).transform(Number);

export const SimulationFormSchema = z.strictObject({
  discountPercent: PercentTextSchema,
  assumedAdditionalUnits: IntegerTextSchema.pipe(ScenarioInputSchema.shape.assumedAdditionalUnits),
  assumedPromotionCostIdr: IntegerTextSchema.pipe(MoneySchema),
}).transform((values) => ({
  offer: values.discountPercent === 0
    ? { offerType: "normal_price", discountBps: 0 }
    : { offerType: "percent_discount", discountBps: values.discountPercent },
  assumedAdditionalUnits: values.assumedAdditionalUnits,
  assumedPromotionCostIdr: values.assumedPromotionCostIdr,
})).pipe(ScenarioInputSchema);

export type SimulationFacts = z.infer<typeof SimulationFactsSchema>;
export type ScenarioInput = z.infer<typeof ScenarioInputSchema>;
export type SimulationResult = z.infer<typeof SimulationResultSchema>;
export type ScenarioComparisonResult = z.infer<typeof ScenarioComparisonResultSchema>;
export type SimulationMessage = z.infer<typeof SimulationMessageSchema>;
export type SimulationFormValues = z.input<typeof SimulationFormSchema>;
export type SimulationOutcome<T> =
  | { success: true; data: T }
  | { success: false; errors: SimulationMessage[] };
