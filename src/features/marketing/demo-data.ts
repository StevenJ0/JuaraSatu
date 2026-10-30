/** PRD §15: synthetic presentation fixture, not a simulator or transaction source. */
export const demo = {
  product: "Brownies Original",
  campaign: "Brownies Sabtu",
  capacity: 40,
  previouslyAllocated: 25,
  basePrice: 50_000,
  variableCost: 30_000,
  discountPercent: 10,
  target: 15,
  fulfilled: 10,
  actualPromotionCost: 50_000,
};

export const initialAvailable = demo.capacity - demo.previouslyAllocated;
export const offerPrice = demo.basePrice * (100 - demo.discountPercent) / 100;
export const unitContribution = offerPrice - demo.variableCost;
export const fulfilledValue = demo.fulfilled * offerPrice;
export const fulfilledVariableCost = demo.fulfilled * demo.variableCost;
export const estimatedContribution = fulfilledValue - fulfilledVariableCost - demo.actualPromotionCost;
export const goalCompletion = demo.fulfilled / demo.target;
export const finalAvailable = initialAvailable - demo.fulfilled;

export function rupiah(value: number) {
  return `Rp${new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 }).format(value)}`;
}

export const completionLabel = new Intl.NumberFormat("id-ID", {
  style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1,
}).format(goalCompletion);
