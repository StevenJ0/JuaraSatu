import { describe, expect, it } from "vitest";
import { calculateOrderPrice } from "../../src/features/pricing";
import {
  compareScenarios,
  simulateCampaign,
  SimulationFormSchema,
  SimulationResultSchema,
  ScenarioComparisonResultSchema,
} from "../../src/features/campaign-simulator";
import {
  developmentFacts,
  developmentScenario,
} from "../../src/features/campaign-simulator/development-fixtures";

describe("campaign simulator", () => {
  it("matches the golden scenario and C2 pricing", () => {
    const result = simulateCampaign(developmentFacts, developmentScenario);
    expect(result).toMatchObject({ success: true, data: {
      frozenBaseUnitPriceIdr: 120_000,
      hypotheticalFinalUnitPriceIdr: 108_000,
      discountPerUnitIdr: 12_000,
      contributionPerUnitIdr: 33_000,
      scenarioRevenueIdr: 864_000,
      scenarioVariableCostIdr: 600_000,
      assumedPromotionCostIdr: 50_000,
      scenarioContributionIdr: 214_000,
      feasible: true,
      blockers: [],
      snapshot: developmentFacts.snapshot,
    } });
    if (!result.success) throw new Error("Expected a calculated scenario");
    expect(SimulationResultSchema.safeParse(result.data).success).toBe(true);
    expect(calculateOrderPrice({
      baseUnitPriceIdr: developmentFacts.baseUnitPriceIdr,
      offer: developmentScenario.offer,
      quantity: developmentScenario.assumedAdditionalUnits,
    })).toMatchObject({ success: true, data: { totalIdr: result.data.scenarioRevenueIdr } });
  });

  it("calculates 5% from the frozen base, independently of the current 10% offer", () => {
    expect(simulateCampaign(developmentFacts, {
      ...developmentScenario,
      offer: { offerType: "percent_discount", discountBps: 500 },
    })).toMatchObject({ success: true, data: {
      frozenBaseUnitPriceIdr: 120_000,
      currentOffer: { unitPriceIdr: 108_000 },
      hypotheticalFinalUnitPriceIdr: 114_000,
      scenarioContributionIdr: 262_000,
    } });
  });

  it("supports zero additional units without relaxing C2 checkout quantity", () => {
    expect(simulateCampaign(developmentFacts, {
      ...developmentScenario, assumedAdditionalUnits: 0,
    })).toMatchObject({ success: true, data: {
      scenarioRevenueIdr: 0, scenarioVariableCostIdr: 0,
      scenarioContributionIdr: -50_000, feasible: true,
      warnings: expect.arrayContaining([expect.objectContaining({ code: "NONPOSITIVE_SCENARIO" })]),
    } });
    expect(calculateOrderPrice({
      baseUnitPriceIdr: 120_000, offer: developmentScenario.offer, quantity: 0,
    })).toMatchObject({ success: false });
  });

  it("reports capacity excess as a blocker, never silently clamps it", () => {
    expect(simulateCampaign(developmentFacts, {
      ...developmentScenario, assumedAdditionalUnits: 9,
    })).toMatchObject({ success: true, data: {
      assumedAdditionalUnits: 9, feasible: false,
      blockers: expect.arrayContaining([expect.objectContaining({ code: "CAPACITY_EXCEEDED" })]),
    } });
  });

  it("keeps unknown costs null and blocks discount planning", () => {
    const facts = { ...developmentFacts, variableCostIdr: null, costQuality: "unknown" };
    expect(simulateCampaign(facts, developmentScenario)).toMatchObject({ success: true, data: {
      contributionPerUnitIdr: null, scenarioVariableCostIdr: null,
      scenarioContributionIdr: null, feasible: false,
      blockers: expect.arrayContaining([expect.objectContaining({ code: "COST_UNKNOWN" })]),
    } });
    expect(simulateCampaign(facts, {
      ...developmentScenario, offer: { offerType: "normal_price", discountBps: 0 },
    })).toMatchObject({ success: true, data: {
      scenarioContributionIdr: null, feasible: true,
      warnings: expect.arrayContaining([expect.objectContaining({ code: "COST_UNKNOWN" })]),
    } });
  });

  it("distinguishes verified zero cost from unknown cost", () => {
    expect(simulateCampaign({ ...developmentFacts, variableCostIdr: 0 }, developmentScenario))
      .toMatchObject({ success: true, data: {
        contributionPerUnitIdr: 108_000, scenarioVariableCostIdr: 0,
        scenarioContributionIdr: 814_000, feasible: true,
      } });
  });

  it("reuses C2 policy blockers and estimated-cost warnings", () => {
    expect(simulateCampaign({ ...developmentFacts, variableCostIdr: 110_000 }, developmentScenario))
      .toMatchObject({ success: true, data: {
        scenarioContributionIdr: -66_000, feasible: false,
        blockers: expect.arrayContaining([expect.objectContaining({ code: "NONPOSITIVE_CONTRIBUTION" })]),
      } });
    expect(simulateCampaign({ ...developmentFacts, costQuality: "estimated" }, developmentScenario))
      .toMatchObject({ success: true, data: {
        warnings: expect.arrayContaining([expect.objectContaining({ code: "COST_ESTIMATED" })]),
      } });
  });

  it("uses C2 per-unit floor rounding", () => {
    expect(simulateCampaign({
      ...developmentFacts, baseUnitPriceIdr: 101, variableCostIdr: 50, currentOffer: null,
    }, {
      offer: { offerType: "percent_discount", discountBps: 500 },
      assumedAdditionalUnits: 3, assumedPromotionCostIdr: 0,
    })).toMatchObject({ success: true, data: {
      discountPerUnitIdr: 5, hypotheticalFinalUnitPriceIdr: 96,
      scenarioRevenueIdr: 288, scenarioVariableCostIdr: 150, scenarioContributionIdr: 138,
    } });
  });

  it.each([-1, 1.5, "50000", 1_000_000_001, Number.MAX_SAFE_INTEGER + 1, Infinity, NaN])(
    "rejects invalid promotion cost %s", (assumedPromotionCostIdr) => {
      expect(simulateCampaign(developmentFacts, { ...developmentScenario, assumedPromotionCostIdr }))
        .toMatchObject({ success: false });
    },
  );

  it.each([-1, 0.5, "8", 10_001, Number.MAX_SAFE_INTEGER + 1, Infinity])(
    "rejects invalid scenario units %s", (assumedAdditionalUnits) => {
      expect(simulateCampaign(developmentFacts, { ...developmentScenario, assumedAdditionalUnits }))
        .toMatchObject({ success: false });
    },
  );

  it.each([
    { offerType: "percent_discount", discountBps: 10_000 },
    { offerType: "percent_discount", discountBps: -1 },
    { offerType: "fixed_discount", discountBps: 1_000 },
    { offerType: "normal_price", discountBps: 500 },
  ])("rejects invalid or unsupported offers", (offer) => {
    expect(simulateCampaign(developmentFacts, { ...developmentScenario, offer }))
      .toMatchObject({ success: false });
  });

  it("rejects inconsistent authoritative data and extra authoritative scenario fields", () => {
    expect(simulateCampaign({ ...developmentFacts, variableCostIdr: null }, developmentScenario))
      .toMatchObject({ success: false });
    expect(simulateCampaign(developmentFacts, { ...developmentScenario, baseUnitPriceIdr: 1 }))
      .toMatchObject({ success: false });
    expect(simulateCampaign({ ...developmentFacts, orderableUnits: -1 }, developmentScenario))
      .toMatchObject({ success: false });
  });

  it("rejects a current offer from another preorder or source version", () => {
    expect(simulateCampaign({ ...developmentFacts, currentOffer: {
      ...developmentFacts.currentOffer, preorderId: "22222222-2222-4222-8222-222222222222",
    } }, developmentScenario)).toMatchObject({ success: false });
    expect(simulateCampaign({ ...developmentFacts, currentOffer: {
      ...developmentFacts.currentOffer, preorderItemVersion: 99,
    } }, developmentScenario)).toMatchObject({ success: false });
    expect(simulateCampaign({ ...developmentFacts, currentOffer: {
      ...developmentFacts.currentOffer, unitPriceIdr: 1,
    } }, developmentScenario)).toMatchObject({ success: false });
  });

  it("labels unavailable current-offer data without pretending normal price is active", () => {
    expect(simulateCampaign({ ...developmentFacts, currentOffer: null }, developmentScenario))
      .toMatchObject({ success: true, data: {
        currentOffer: null,
        warnings: expect.arrayContaining([expect.objectContaining({ code: "CURRENT_OFFER_UNAVAILABLE" })]),
      } });
  });

  it.each(["closed", "cancelled", "completed"])("blocks a %s preorder snapshot", (preorderStatus) => {
    expect(simulateCampaign({ ...developmentFacts, preorderStatus }, developmentScenario))
      .toMatchObject({ success: true, data: { feasible: false,
        blockers: expect.arrayContaining([expect.objectContaining({ code: "PREORDER_NOT_OPEN" })]),
      } });
  });

  it("uses snapshot time for deterministic deadline checks", () => {
    expect(simulateCampaign({ ...developmentFacts, snapshot: {
      ...developmentFacts.snapshot, calculatedAt: developmentFacts.endsAt,
    } }, developmentScenario)).toMatchObject({ success: true, data: { feasible: false } });
    expect(simulateCampaign({ ...developmentFacts, endsAt: developmentFacts.startsAt }, developmentScenario))
      .toMatchObject({ success: false });
  });

  it("rejects revenue, variable-cost and signed-contribution overflow", () => {
    for (const facts of [
      { ...developmentFacts, baseUnitPriceIdr: 1_000_000_000, currentOffer: null },
      { ...developmentFacts, variableCostIdr: 1_000_000_000 },
    ]) {
      expect(simulateCampaign(facts, developmentScenario)).toMatchObject({ success: false });
    }
    expect(simulateCampaign({ ...developmentFacts, variableCostIdr: 1_000_000_000 }, {
      ...developmentScenario, assumedAdditionalUnits: 1, assumedPromotionCostIdr: 1_000_000_000,
    })).toMatchObject({ success: false });
  });

  it("does not mutate facts/scenarios and emits deterministic JSON-safe results", () => {
    const before = JSON.stringify({ facts: developmentFacts, scenario: developmentScenario });
    const facts = Object.freeze({ ...developmentFacts, snapshot: Object.freeze({ ...developmentFacts.snapshot }) });
    const first = simulateCampaign(facts, Object.freeze({ ...developmentScenario }));
    expect(simulateCampaign(facts, developmentScenario)).toEqual(first);
    const roundTrip: unknown = JSON.parse(JSON.stringify(first));
    expect(roundTrip).toEqual(first);
    if (first.success) first.data.snapshot.preorderVersion = 999;
    expect(JSON.stringify({ facts: developmentFacts, scenario: developmentScenario })).toBe(before);
  });
});

describe("scenario comparison", () => {
  const offers = [
    { offerType: "normal_price", discountBps: 0 },
    { offerType: "percent_discount", discountBps: 500 },
    { offerType: "percent_discount", discountBps: 1_000 },
  ];
  it("compares the same unit/spend assumptions without picking a winner", () => {
    const scenarios = offers.map((offer) => ({ ...developmentScenario, offer }));
    const result = compareScenarios(developmentFacts, scenarios);
    expect(result).toMatchObject({ success: true, data: { warnings: [] } });
    if (!result.success) throw new Error("Expected comparison");
    expect(ScenarioComparisonResultSchema.safeParse(result.data).success).toBe(true);
    expect(result.data.scenarios.map((s) => s.scenarioContributionIdr)).toEqual([310_000, 262_000, 214_000]);
    scenarios.forEach((scenario, index) => {
      expect(simulateCampaign(developmentFacts, scenario)).toEqual({ success: true, data: result.data.scenarios[index] });
    });
  });

  it("explicitly warns when scenarios use different assumptions", () => {
    expect(compareScenarios(developmentFacts, [developmentScenario, {
      ...developmentScenario, assumedAdditionalUnits: 1, assumedPromotionCostIdr: 0,
    }])).toMatchObject({ success: true, data: {
      warnings: [expect.objectContaining({ code: "DIFFERENT_ASSUMPTIONS" })],
    } });
  });

  it("preserves independent volumes and spending for baseline and campaign alternatives", () => {
    const scenarios = [
      { offer: offers[0], assumedAdditionalUnits: 4, assumedPromotionCostIdr: 0 },
      { offer: offers[1], assumedAdditionalUnits: 6, assumedPromotionCostIdr: 25_000 },
      developmentScenario,
    ];
    const before = structuredClone(scenarios);
    const result = compareScenarios(developmentFacts, scenarios);
    expect(result.success).toBe(true);
    if (!result.success) throw new Error("Expected independent comparison");
    expect(result.data.scenarios.map((s) => [
      s.hypotheticalFinalUnitPriceIdr, s.assumedAdditionalUnits, s.assumedPromotionCostIdr,
      s.scenarioRevenueIdr, s.scenarioVariableCostIdr, s.scenarioContributionIdr,
    ])).toEqual([
      [120_000, 4, 0, 480_000, 300_000, 180_000],
      [114_000, 6, 25_000, 684_000, 450_000, 209_000],
      [108_000, 8, 50_000, 864_000, 600_000, 214_000],
    ]);
    expect(result.data.scenarios.every((s) => s.feasible && s.assumedAdditionalUnits <= developmentFacts.orderableUnits)).toBe(true);
    expect(result.data.warnings).toEqual([expect.objectContaining({ code: "DIFFERENT_ASSUMPTIONS" })]);
    scenarios.forEach((scenario, index) => {
      expect(simulateCampaign(developmentFacts, scenario)).toEqual({ success: true, data: result.data.scenarios[index] });
    });
    expect(scenarios).toEqual(before);
  });

  it("distinguishes normal-price campaign spending from a no-promotion baseline", () => {
    const result = compareScenarios(developmentFacts, [
      { offer: offers[0], assumedAdditionalUnits: 4, assumedPromotionCostIdr: 0 },
      { offer: offers[0], assumedAdditionalUnits: 6, assumedPromotionCostIdr: 25_000 },
    ]);
    expect(result).toMatchObject({ success: true, data: { scenarios: [
      { hypotheticalFinalUnitPriceIdr: 120_000, assumedPromotionCostIdr: 0, scenarioContributionIdr: 180_000 },
      { hypotheticalFinalUnitPriceIdr: 120_000, assumedPromotionCostIdr: 25_000, scenarioContributionIdr: 245_000 },
    ] } });
  });

  it("keeps capacity validation independent for each alternative", () => {
    const result = compareScenarios(developmentFacts, [
      { ...developmentScenario, assumedAdditionalUnits: 4, assumedPromotionCostIdr: 0 },
      { ...developmentScenario, assumedAdditionalUnits: 9, assumedPromotionCostIdr: 25_000 },
    ]);
    expect(result).toMatchObject({ success: true, data: { scenarios: [
      { feasible: true, assumedAdditionalUnits: 4 },
      { feasible: false, assumedAdditionalUnits: 9,
        blockers: [expect.objectContaining({ code: "CAPACITY_EXCEEDED" })] },
    ] } });
  });

  it("retains financially blocked scenarios and rejects malformed comparisons", () => {
    expect(compareScenarios({ ...developmentFacts, variableCostIdr: null, costQuality: "unknown" }, [
      { ...developmentScenario, offer: offers[0] }, developmentScenario,
    ])).toMatchObject({ success: true, data: { scenarios: [
      expect.objectContaining({ feasible: true }), expect.objectContaining({ feasible: false }),
    ] } });
    for (const scenarios of [[], [developmentScenario], [null, developmentScenario]]) {
      expect(compareScenarios(developmentFacts, scenarios)).toMatchObject({ success: false });
    }
  });
});

describe("simulator form input", () => {
  it.each([["10", 1_000], ["5,25", 525], ["0.01", 1], ["99.99", 9_999], ["0", 0]])(
    "converts %s percent into %s bps using integer parts", (discountPercent, discountBps) => {
      const parsed = SimulationFormSchema.parse({ discountPercent: String(discountPercent), assumedAdditionalUnits: "0", assumedPromotionCostIdr: "50000" });
      expect(parsed.offer.discountBps).toBe(discountBps);
      expect(parsed.assumedAdditionalUnits).toBe(0);
    },
  );
  it.each(["", "100", "1.001", "-1", "1e1", "12abc"])("rejects invalid percent %s", (discountPercent) => {
    expect(SimulationFormSchema.safeParse({ discountPercent, assumedAdditionalUnits: "8", assumedPromotionCostIdr: "50000" }).success).toBe(false);
  });
  it.each(["", "-1", "1e3", "1.5", "12abc"])("rejects invalid integer input %s", (value) => {
    expect(SimulationFormSchema.safeParse({ discountPercent: "10", assumedAdditionalUnits: value, assumedPromotionCostIdr: "50000" }).success).toBe(false);
    expect(SimulationFormSchema.safeParse({ discountPercent: "10", assumedAdditionalUnits: "8", assumedPromotionCostIdr: value }).success).toBe(false);
  });
});
