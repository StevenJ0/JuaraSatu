import type {
  OrderPricingInput,
  OrderPricingResult,
} from "../../src/features/pricing";

export const pricingGoldenCases = [
  {
    name: "10% discount on two units",
    input: {
      baseUnitPriceIdr: 120_000,
      offer: { offerType: "percent_discount", discountBps: 1_000 },
      quantity: 2,
    },
    expected: {
      baseUnitPriceIdr: 120_000,
      discountPerUnitIdr: 12_000,
      finalUnitPriceIdr: 108_000,
      quantity: 2,
      subtotalIdr: 240_000,
      discountTotalIdr: 24_000,
      totalIdr: 216_000,
    },
  },
  {
    name: "rounding down the discount per unit before multiplying",
    input: {
      baseUnitPriceIdr: 101,
      offer: { offerType: "percent_discount", discountBps: 500 },
      quantity: 3,
    },
    expected: {
      baseUnitPriceIdr: 101,
      discountPerUnitIdr: 5,
      finalUnitPriceIdr: 96,
      quantity: 3,
      subtotalIdr: 303,
      discountTotalIdr: 15,
      totalIdr: 288,
    },
  },
  {
    name: "normal price without a discount",
    input: {
      baseUnitPriceIdr: 120_000,
      offer: { offerType: "normal_price", discountBps: 0 },
      quantity: 2,
    },
    expected: {
      baseUnitPriceIdr: 120_000,
      discountPerUnitIdr: 0,
      finalUnitPriceIdr: 120_000,
      quantity: 2,
      subtotalIdr: 240_000,
      discountTotalIdr: 0,
      totalIdr: 240_000,
    },
  },
] satisfies ReadonlyArray<{
  name: string;
  input: OrderPricingInput;
  expected: OrderPricingResult;
}>;
