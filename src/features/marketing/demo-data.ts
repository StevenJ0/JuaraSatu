/**
 * PRD v2.1 §16.5: synthetic presentation fixture only.
 * Never import this into checkout, payments, capacity or business analytics.
 * Production pricing belongs to the shared calculator, outside landing scope.
 */
export const demo = {
  product: "Kaos Oversized",
  preorder: "Preorder Kaos November",
  campaign: "Promo Kaos November",
  capacity: 40,
  quota: 40,
  target: 40,
  initialPaidUnits: 30,
  initialHeldUnits: 2,
  releasedHeldUnits: 2,
  basePrice: 120_000,
  variableCost: 75_000,
  discountBps: 1_000,
  campaignTargetUnits: 10,
  campaignPaidUnits: 8,
  campaignAttributedUnits: 5,
  campaignDiscountedUnits: 8,
  campaignFulfilledUnits: 8,
  finalHeldUnits: 0,
  actualPromotionCost: 50_000,
} as const;

export const initialAvailable = demo.capacity - demo.initialPaidUnits - demo.initialHeldUnits;
export const initialTargetGap = demo.target - demo.initialPaidUnits;
export const campaignStartAvailable = initialAvailable + demo.releasedHeldUnits;
export const discountPercent = demo.discountBps / 100;
export const unitDiscount = Math.floor(demo.basePrice * demo.discountBps / 10_000);
export const offerPrice = demo.basePrice - unitDiscount;
export const unitContribution = offerPrice - demo.variableCost;
export const finalPaidUnits = demo.initialPaidUnits + demo.campaignPaidUnits;
// In this final synthetic snapshot, all paid units have been fulfilled.
export const finalFulfilledUnits = demo.initialPaidUnits + demo.campaignFulfilledUnits;
export const finalAvailable = demo.capacity - finalPaidUnits - demo.finalHeldUnits;
export const finalTargetGap = demo.target - finalPaidUnits;
export const campaignUnattributedUnits = demo.campaignPaidUnits - demo.campaignAttributedUnits;
export const campaignRevenue = demo.campaignFulfilledUnits * offerPrice;
export const campaignProductionCost = demo.campaignFulfilledUnits * demo.variableCost;
export const campaignContribution = campaignRevenue - campaignProductionCost - demo.actualPromotionCost;
export const preorderRevenue = demo.initialPaidUnits * demo.basePrice + campaignRevenue;
export const preorderProductionCost = finalFulfilledUnits * demo.variableCost;
export const preorderContribution = preorderRevenue - preorderProductionCost - demo.actualPromotionCost;
export const goalCompletion = finalPaidUnits / demo.target;

export function rupiah(value: number) {
  return `Rp${new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 }).format(value)}`;
}

export const completionLabel = new Intl.NumberFormat("id-ID", {
  style: "percent", maximumFractionDigits: 0,
}).format(goalCompletion);
