import { z } from "zod";

export const MAX_MONEY_IDR = 1_000_000_000;
const MoneySchema = z.number().int().min(0).max(MAX_MONEY_IDR);

const OfferSchema = z.discriminatedUnion("offerType", [
  z.strictObject({
    offerType: z.literal("normal_price"),
    discountBps: z.literal(0),
  }),
  z.strictObject({
    offerType: z.literal("percent_discount"),
    discountBps: z.number().int().min(1).max(9_999),
  }),
]);

export const UnitPricingInputSchema = z.strictObject({
  baseUnitPriceIdr: MoneySchema.positive(),
  offer: OfferSchema,
});

export const OrderPricingInputSchema = UnitPricingInputSchema.extend({
  quantity: z.number().int().min(1).max(10_000),
});

export const DiscountPolicyInputSchema = z.discriminatedUnion("costQuality", [
  UnitPricingInputSchema.extend({
    costQuality: z.literal("unknown"),
    variableCostIdr: z.null(),
  }),
  UnitPricingInputSchema.extend({
    costQuality: z.enum(["estimated", "verified"]),
    variableCostIdr: MoneySchema,
  }),
]);

const UnitPricingFields = {
  baseUnitPriceIdr: MoneySchema.positive(),
  discountPerUnitIdr: MoneySchema,
  finalUnitPriceIdr: MoneySchema.positive(),
};

export const UnitPricingResultSchema = z.strictObject(UnitPricingFields).refine(
  (price) =>
    price.finalUnitPriceIdr === price.baseUnitPriceIdr - price.discountPerUnitIdr,
  { message: "Harga final harus sama dengan harga dasar dikurangi diskon." },
);

export const OrderPricingResultSchema = z.strictObject({
  ...UnitPricingFields,
  quantity: z.number().int().min(1).max(10_000),
  subtotalIdr: MoneySchema,
  discountTotalIdr: MoneySchema,
  totalIdr: MoneySchema.positive(),
}).refine(
  (price) =>
    price.finalUnitPriceIdr === price.baseUnitPriceIdr - price.discountPerUnitIdr &&
    price.subtotalIdr === price.baseUnitPriceIdr * price.quantity &&
    price.discountTotalIdr === price.discountPerUnitIdr * price.quantity &&
    price.totalIdr === price.finalUnitPriceIdr * price.quantity,
  { message: "Total pesanan harus konsisten dengan harga dan quantity." },
);

export const PricingErrorSchema = z.strictObject({
  code: z.enum([
    "INVALID_INPUT",
    "AMOUNT_OUT_OF_RANGE",
    "COST_UNKNOWN",
    "NONPOSITIVE_CONTRIBUTION",
  ]),
  field: z.string().min(1),
  message: z.string().min(1),
});

export const PricingFailureSchema = z.strictObject({
  success: z.literal(false),
  errors: z.array(PricingErrorSchema).min(1),
});

export const PricingWarningSchema = z.strictObject({
  code: z.enum(["COST_UNKNOWN", "COST_ESTIMATED", "NONPOSITIVE_CONTRIBUTION"]),
  message: z.string().min(1),
});

export const DiscountPolicyResultSchema = z.strictObject({
  ...UnitPricingFields,
  costQuality: z.enum(["unknown", "estimated", "verified"]),
  variableCostIdr: MoneySchema.nullable(),
  contributionPerUnitIdr: z.number().int()
    .min(-MAX_MONEY_IDR).max(MAX_MONEY_IDR).nullable(),
  warnings: z.array(PricingWarningSchema),
}).refine(
  (result) =>
    result.finalUnitPriceIdr === result.baseUnitPriceIdr - result.discountPerUnitIdr &&
    (result.costQuality === "unknown") === (result.variableCostIdr === null) &&
    result.contributionPerUnitIdr ===
      (result.variableCostIdr === null
        ? null
        : result.finalUnitPriceIdr - result.variableCostIdr),
  { message: "Biaya, quality, dan kontribusi harus konsisten." },
);

export type UnitPricingInput = z.infer<typeof UnitPricingInputSchema>;
export type OrderPricingInput = z.infer<typeof OrderPricingInputSchema>;
export type DiscountPolicyInput = z.infer<typeof DiscountPolicyInputSchema>;
export type UnitPricingResult = z.infer<typeof UnitPricingResultSchema>;
export type OrderPricingResult = z.infer<typeof OrderPricingResultSchema>;
export type DiscountPolicyResult = z.infer<typeof DiscountPolicyResultSchema>;
export type PricingError = z.infer<typeof PricingErrorSchema>;
export type PricingFailure = z.infer<typeof PricingFailureSchema>;
export type PricingWarning = z.infer<typeof PricingWarningSchema>;

export type PricingResult<T> = { success: true; data: T } | PricingFailure;
