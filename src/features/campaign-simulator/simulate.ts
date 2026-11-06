import type { z } from "zod";
import { calculateOrderPrice, calculateUnitPrice, validateCampaignDiscount } from "../pricing";
import {
  ScenarioComparisonInputSchema,
  ScenarioInputSchema,
  SimulationFactsSchema,
  SimulationResultSchema,
  type ScenarioComparisonResult,
  type SimulationMessage,
  type SimulationOutcome,
  type SimulationResult,
} from "./contracts";

function invalidInput(
  error: z.ZodError,
  code: "INVALID_INPUT" | "AMOUNT_OUT_OF_RANGE" = "INVALID_INPUT",
) {
  return {
    success: false,
    errors: error.issues.map((issue) => ({
      code,
      field: issue.path.map(String).join(".") || "input",
      message: code === "AMOUNT_OUT_OF_RANGE"
        ? "Hasil skenario melampaui rentang nominal Rp1 miliar. Kurangi asumsi unit atau biaya."
        : issue.message,
    })),
  } satisfies SimulationOutcome<never>;
}

/** Facts must come from authorized server readers; scenarios never override them. */
export function simulateCampaign(
  factsInput: unknown,
  scenarioInput: unknown,
): SimulationOutcome<SimulationResult> {
  const factsParsed = SimulationFactsSchema.safeParse(factsInput);
  if (!factsParsed.success) return invalidInput(factsParsed.error);
  const scenarioParsed = ScenarioInputSchema.safeParse(scenarioInput);
  if (!scenarioParsed.success) return invalidInput(scenarioParsed.error);
  const facts = factsParsed.data;
  const scenario = scenarioParsed.data;

  if (facts.currentOffer !== null) {
    const current = facts.currentOffer;
    const currentPrice = calculateUnitPrice({ baseUnitPriceIdr: facts.baseUnitPriceIdr, offer: current.offer });
    if (current.preorderId !== facts.preorderId || current.preorderItemId !== facts.preorderItemId ||
      current.preorderItemVersion !== facts.snapshot.preorderItemVersion ||
      !currentPrice.success || currentPrice.data.finalUnitPriceIdr !== current.unitPriceIdr) {
      return { success: false, errors: [{
        code: "SOURCE_MISMATCH", field: "currentOffer",
        message: "Penawaran saat ini tidak cocok dengan snapshot preorder. Muat ulang sumber data.",
      }] };
    }
  }

  const pricingInput = { baseUnitPriceIdr: facts.baseUnitPriceIdr, offer: scenario.offer };
  const unit = calculateUnitPrice(pricingInput);
  if (!unit.success) return unit;
  let revenue = 0;
  if (scenario.assumedAdditionalUnits > 0) {
    const order = calculateOrderPrice({ ...pricingInput, quantity: scenario.assumedAdditionalUnits });
    if (!order.success) return order;
    revenue = order.data.totalIdr;
  }

  const policy = validateCampaignDiscount({
    ...pricingInput, variableCostIdr: facts.variableCostIdr, costQuality: facts.costQuality,
  });
  const warnings: SimulationMessage[] = policy.success
    ? policy.data.warnings.map((warning) => ({ ...warning, field: "variableCostIdr" }))
    : [];
  const blockers: SimulationMessage[] = policy.success ? [] : policy.errors;
  if (scenario.assumedAdditionalUnits > facts.orderableUnits) {
    blockers.push({ code: "CAPACITY_EXCEEDED", field: "assumedAdditionalUnits",
      message: `Asumsi unit melebihi ${facts.orderableUnits} slot yang dapat dipesan pada snapshot ini.` });
  }
  const snapshotTime = Date.parse(facts.snapshot.calculatedAt);
  if (facts.preorderStatus !== "published" || snapshotTime < Date.parse(facts.startsAt) ||
    snapshotTime >= Date.parse(facts.endsAt)) {
    blockers.push({ code: "PREORDER_NOT_OPEN", field: "preorderStatus",
      message: "Preorder belum atau tidak lagi terbuka pada waktu snapshot." });
  }
  if (facts.currentOffer === null) {
    warnings.push({ code: "CURRENT_OFFER_UNAVAILABLE", field: "currentOffer",
      message: "Data penawaran saat ini belum tersedia; harga checkout aktif belum dapat dibandingkan." });
  }

  const contribution = facts.variableCostIdr === null
    ? null : unit.data.finalUnitPriceIdr - facts.variableCostIdr;
  const variableCost = facts.variableCostIdr === null
    ? null : BigInt(facts.variableCostIdr) * BigInt(scenario.assumedAdditionalUnits);
  const scenarioContribution = variableCost === null
    ? null : BigInt(revenue) - variableCost - BigInt(scenario.assumedPromotionCostIdr);
  if (scenarioContribution !== null && scenarioContribution <= BigInt(0)) {
    warnings.push({ code: "NONPOSITIVE_SCENARIO", field: "scenarioContributionIdr",
      message: "Skenario ini tidak menyisakan kontribusi positif setelah biaya promosi." });
  }

  // Validated factors bound intermediates to 10^13, below Number.MAX_SAFE_INTEGER.
  const result = SimulationResultSchema.safeParse({
    schemaVersion: 1,
    businessId: facts.businessId,
    preorderId: facts.preorderId,
    preorderItemId: facts.preorderItemId,
    frozenBaseUnitPriceIdr: facts.baseUnitPriceIdr,
    currentOffer: facts.currentOffer,
    hypotheticalOffer: scenario.offer,
    hypotheticalFinalUnitPriceIdr: unit.data.finalUnitPriceIdr,
    discountPerUnitIdr: unit.data.discountPerUnitIdr,
    contributionPerUnitIdr: contribution,
    assumedAdditionalUnits: scenario.assumedAdditionalUnits,
    assumedPromotionCostIdr: scenario.assumedPromotionCostIdr,
    scenarioRevenueIdr: revenue,
    scenarioVariableCostIdr: variableCost === null ? null : Number(variableCost),
    scenarioContributionIdr: scenarioContribution === null ? null : Number(scenarioContribution),
    feasible: blockers.length === 0,
    warnings, blockers,
    assumptions: [
      "Tambahan unit adalah asumsi pemilik, bukan prediksi atau jaminan penjualan.",
      "Biaya promosi adalah asumsi skenario, bukan biaya aktual yang tercatat.",
      "Slot tersedia adalah snapshot; simulasi tidak mereservasi kapasitas.",
    ],
    snapshot: facts.snapshot,
  });
  if (!result.success) return invalidInput(result.error, "AMOUNT_OUT_OF_RANGE");
  return { success: true, data: result.data };
}

export function compareScenarios(
  facts: unknown,
  scenariosInput: unknown,
): SimulationOutcome<ScenarioComparisonResult> {
  const parsed = ScenarioComparisonInputSchema.safeParse(scenariosInput);
  if (!parsed.success) return invalidInput(parsed.error);
  const scenarios: SimulationResult[] = [];
  for (const [index, scenario] of parsed.data.entries()) {
    const result = simulateCampaign(facts, scenario);
    if (!result.success) return { success: false, errors: result.errors.map((error) => ({
      ...error, field: `scenarios.${index}.${error.field}`,
    })) };
    scenarios.push(result.data);
  }
  const assumptions = new Set(parsed.data.map((scenario) =>
    `${scenario.assumedAdditionalUnits}:${scenario.assumedPromotionCostIdr}`));
  return { success: true, data: { scenarios, warnings: assumptions.size <= 1 ? [] : [{
    code: "DIFFERENT_ASSUMPTIONS", field: "scenarios",
    message: "Asumsi unit atau biaya promosi berbeda. Perbandingan ini tidak memakai kondisi yang sama.",
  }] } };
}
