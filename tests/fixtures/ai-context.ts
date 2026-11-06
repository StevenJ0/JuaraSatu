import type { BuildBusinessContextInput } from "../../src/features/ai-context/contracts";

const businessId = "22222222-2222-4222-8222-222222222221";
const productId = "22222222-2222-4222-8222-222222222222";
const preorderId = "22222222-2222-4222-8222-222222222223";
const preorderItemId = "22222222-2222-4222-8222-222222222224";
const calculatedAt = "2026-11-02T03:00:00Z";
const snapshot = {
  provenance: "development_fixture", calculatedAt,
  preorderVersion: 1, preorderItemVersion: 1, capacityVersion: 1, productVersion: 1,
} as const;

export const contextFixture = {
  scope: { businessId, preorderId }, calculatedAt, maxSourceAgeSeconds: 60,
  analyticsRequirement: "optional",
  c1: { status: "available", data: {
    business: { businessId, name: "Dapur Contoh", category: "Makanan",
      description: "Usaha preorder makanan sintetis untuk pengujian.", locationContext: null },
    product: { businessId, productId, name: "Paket Makan Contoh", category: null,
      description: "Satu paket makanan preorder.", catalogUnitPriceIdr: 130_000,
      variableCostIdr: 75_000, costQuality: "verified" },
    preorder: { businessId, productId, preorderId, preorderItemId,
      preorderName: "Preorder November", baseUnitPriceIdr: 120_000,
      targetUnits: 40, quotaUnits: 40, paidUnits: 30, heldUnits: 2, allocatedUnits: 30, orderableUnits: 8,
      preorderStatus: "published", startsAt: "2026-11-01T00:00:00Z", endsAt: "2026-11-06T11:00:00Z",
      intakeCutoffAt: "2026-11-06T11:00:00Z", fulfillmentDate: "2026-11-07" },
    snapshot,
  } },
  c6: { status: "available", data: {
    businessId, productId, preorderId, preorderItemId,
    metrics: { paidUnits: 30, fulfilledUnits: 0, validOrderValueIdr: 3_600_000,
      fulfilledSalesValueIdr: 0, productionCostIncurredIdr: null, campaignSpendActualIdr: null,
      estimatedContributionIdr: null, costsComplete: false, isProvisional: true, isSandboxData: true },
    snapshot: { ...snapshot, metricsSchemaVersion: 1 },
  } },
  c8: { status: "available", data: {
    businessId, productId, preorderId, preorderItemId, baseUnitPriceIdr: 120_000,
    effectiveOffer: { state: "active", offer: { offerType: "percent_discount", discountBps: 1_000 },
      unitPriceIdr: 108_000, campaign: { businessId, preorderId,
        campaignId: "22222222-2222-4222-8222-222222222225", version: 1, status: "published",
        startsAt: "2026-11-02T00:00:00Z", endsAt: "2026-11-05T11:00:00Z", publishedAt: "2026-11-02T00:00:00Z" } },
    snapshot: { provenance: snapshot.provenance, calculatedAt, preorderVersion: 1,
      preorderItemVersion: 1, offerVersion: "offer-1" },
  } },
  hypotheticalScenario: { offer: { offerType: "percent_discount", discountBps: 500 },
    assumedAdditionalUnits: 6, assumedPromotionCostIdr: 25_000 },
  history: { status: "cold_start", businessId, checkedAt: calculatedAt },
} satisfies BuildBusinessContextInput;

export function freshContextInput(): BuildBusinessContextInput {
  return structuredClone(contextFixture);
}
