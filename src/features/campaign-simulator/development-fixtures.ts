import type { ScenarioInput, SimulationFacts } from "./contracts";

export const developmentFacts = {
  businessId: "11111111-1111-4111-8111-111111111111",
  preorderId: "11111111-1111-4111-8111-111111111112",
  preorderItemId: "11111111-1111-4111-8111-111111111113",
  preorderName: "Preorder Kaos November",
  productName: "Kaos Oversized Hitam · L",
  preorderStatus: "published",
  startsAt: "2026-11-01T00:00:00Z",
  endsAt: "2026-11-06T11:00:00Z",
  intakeCutoffAt: "2026-11-06T11:00:00Z",
  baseUnitPriceIdr: 120_000,
  variableCostIdr: 75_000,
  costQuality: "verified",
  orderableUnits: 8,
  currentOffer: {
    preorderId: "11111111-1111-4111-8111-111111111112",
    preorderItemId: "11111111-1111-4111-8111-111111111113",
    preorderItemVersion: 1,
    offer: { offerType: "percent_discount", discountBps: 1_000 },
    unitPriceIdr: 108_000,
    offerVersion: "fixture-offer-v1",
    calculatedAt: "2026-11-02T03:00:00Z",
  },
  snapshot: {
    provenance: "development_fixture",
    calculatedAt: "2026-11-02T03:00:00Z",
    preorderVersion: 1, preorderItemVersion: 1, capacityVersion: 1, productVersion: 1,
  },
} satisfies SimulationFacts;

export const developmentScenario = {
  offer: { offerType: "percent_discount", discountBps: 1_000 },
  assumedAdditionalUnits: 8,
  assumedPromotionCostIdr: 50_000,
} satisfies ScenarioInput;
