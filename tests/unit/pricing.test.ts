import { describe, expect, it, vi } from "vitest";
import {
  calculateOrderPrice,
  calculateUnitPrice,
  DiscountPolicyInputSchema,
  DiscountPolicyResultSchema,
  OrderPricingInputSchema,
  OrderPricingResultSchema,
  PricingFailureSchema,
  UnitPricingInputSchema,
  UnitPricingResultSchema,
  validateCampaignDiscount,
} from "../../src/features/pricing";
import { pricingGoldenCases } from "../fixtures/pricing";

const unitInput = {
  baseUnitPriceIdr: 120_000,
  offer: { offerType: "percent_discount", discountBps: 1_000 },
};

describe("shared pricing", () => {
  it.each(pricingGoldenCases)("$name", ({ input, expected }) => {
    expect(OrderPricingInputSchema.safeParse(input).success).toBe(true);
    expect(calculateOrderPrice(input)).toEqual({ success: true, data: expected });
    const { baseUnitPriceIdr, discountPerUnitIdr, finalUnitPriceIdr } = expected;
    expect(calculateUnitPrice({ baseUnitPriceIdr, offer: input.offer })).toEqual({
      success: true,
      data: { baseUnitPriceIdr, discountPerUnitIdr, finalUnitPriceIdr },
    });
    expect(OrderPricingResultSchema.safeParse(expected).success).toBe(true);
    expect(
      UnitPricingResultSchema.safeParse({
        baseUnitPriceIdr,
        discountPerUnitIdr,
        finalUnitPriceIdr,
      }).success,
    ).toBe(true);
  });

  it.each([0, -1, 1.5, 10_001, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity, "2", null])(
    "rejects invalid order quantity %s",
    (quantity) => {
      const result = calculateOrderPrice({ ...unitInput, quantity });
      expect(result).toMatchObject({
        success: false,
        errors: expect.arrayContaining([
          expect.objectContaining({ code: "INVALID_INPUT", field: "quantity" }),
        ]),
      });
      expect(PricingFailureSchema.safeParse(result).success).toBe(true);
    },
  );

  it.each([0, -1, 0.5, 1_000_000_001, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity, "120000", null])(
    "rejects invalid base price %s",
    (baseUnitPriceIdr) => {
      expect(calculateUnitPrice({ ...unitInput, baseUnitPriceIdr })).toMatchObject({
        success: false,
        errors: expect.arrayContaining([
          expect.objectContaining({ code: "INVALID_INPUT", field: "baseUnitPriceIdr" }),
        ]),
      });
    },
  );

  it.each([0, -1, 0.5, 10_000, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity, "1000", null])(
    "rejects invalid percent discount %s",
    (discountBps) => {
      expect(
        calculateUnitPrice({
          ...unitInput,
          offer: { offerType: "percent_discount", discountBps },
        }),
      ).toMatchObject({
        success: false,
        errors: expect.arrayContaining([expect.objectContaining({ code: "INVALID_INPUT" })]),
      });
    },
  );

  it.each([
    { offerType: "fixed_discount", discountBps: 1_000 },
    { offerType: "normal_price", discountBps: 1_000 },
    { offerType: "percent_discount" },
    { offerType: "percent_discount", discountBps: 1_000, finalPriceIdr: 1 },
  ])("rejects unsupported or inconsistent offers", (offer) => {
    expect(calculateUnitPrice({ ...unitInput, offer })).toMatchObject({
      success: false,
      errors: [{ code: "INVALID_INPUT" }],
    });
  });

  it.each([undefined, null, false, [], 120_000, "120000"])(
    "rejects malformed payload %s without throwing",
    (input) => {
      for (const calculate of [calculateUnitPrice, calculateOrderPrice, validateCampaignDiscount]) {
        expect(calculate(input)).toMatchObject({
          success: false,
          errors: [{ code: "INVALID_INPUT" }],
        });
      }
    },
  );

  it("rejects catalog/campaign authority and unknown fields at the boundary", () => {
    for (const extra of [{ catalogPriceIdr: 150_000 }, { campaignId: "untrusted" }]) {
      expect(calculateUnitPrice({ ...unitInput, ...extra })).toMatchObject({ success: false });
    }
    expect(UnitPricingInputSchema.safeParse({ ...unitInput, quantity: 2 }).success).toBe(false);
  });

  it("accepts the money ceiling and the maximum quantity when totals fit", () => {
    expect(calculateOrderPrice({
      baseUnitPriceIdr: 100_000,
      offer: { offerType: "normal_price", discountBps: 0 },
      quantity: 10_000,
    })).toMatchObject({ success: true, data: { subtotalIdr: 1_000_000_000, totalIdr: 1_000_000_000 } });
    expect(calculateUnitPrice({ ...unitInput, baseUnitPriceIdr: 1_000_000_000 })).toMatchObject({
      success: true,
      data: { discountPerUnitIdr: 100_000_000, finalUnitPriceIdr: 900_000_000 },
    });
  });

  it("accepts 9999 bps and preserves a positive final price for tiny IDR amounts", () => {
    expect(calculateUnitPrice({
      baseUnitPriceIdr: 101,
      offer: { offerType: "percent_discount", discountBps: 9_999 },
    })).toEqual({ success: true, data: {
      baseUnitPriceIdr: 101, discountPerUnitIdr: 100, finalUnitPriceIdr: 1,
    } });
    expect(calculateUnitPrice({
      baseUnitPriceIdr: 1,
      offer: { offerType: "percent_discount", discountBps: 1 },
    })).toMatchObject({ success: true, data: { discountPerUnitIdr: 0, finalUnitPriceIdr: 1 } });
  });

  it.each([2, 10_000])("rejects overflowing totals for quantity %s", (quantity) => {
    expect(calculateOrderPrice({
      baseUnitPriceIdr: 1_000_000_000,
      offer: { offerType: "normal_price", discountBps: 0 },
      quantity,
    })).toMatchObject({
      success: false,
      errors: [{ code: "AMOUNT_OUT_OF_RANGE", field: "subtotalIdr" }],
    });
  });

  it("also bounds the undiscounted subtotal when the final total would fit", () => {
    expect(calculateOrderPrice({
      baseUnitPriceIdr: 1_000_000_000,
      offer: { offerType: "percent_discount", discountBps: 9_999 },
      quantity: 10_000,
    })).toMatchObject({ success: false, errors: [{ code: "AMOUNT_OUT_OF_RANGE" }] });
  });

  it("uses the supplied preorder snapshot even when catalog prices differ", () => {
    const preorderItem = { base_price_snapshot_idr: 120_000 };
    const product = { base_price_idr: 150_000 };
    expect(product.base_price_idr).not.toBe(preorderItem.base_price_snapshot_idr);
    expect(calculateUnitPrice({
      ...unitInput, baseUnitPriceIdr: preorderItem.base_price_snapshot_idr,
    })).toMatchObject({ success: true, data: { finalUnitPriceIdr: 108_000 } });
  });

  it("does not mutate inputs and is deterministic without provider configuration", () => {
    const input = Object.freeze({ ...unitInput, offer: Object.freeze(unitInput.offer), quantity: 2 });
    const first = calculateOrderPrice(input);
    try {
      vi.stubEnv("GEMINI_API_KEY", undefined);
      vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", undefined);
      vi.stubEnv("MIDTRANS_SERVER_KEY", undefined);
      expect(calculateOrderPrice(input)).toEqual(first);
      if (first.success) first.data.totalIdr = 1;
      expect(calculateOrderPrice(input)).toMatchObject({ success: true, data: { totalIdr: 216_000 } });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("returns JSON-safe numbers rather than BigInt values", () => {
    const result = calculateOrderPrice({ ...unitInput, quantity: 2 });
    const decoded: unknown = JSON.parse(JSON.stringify(result));
    expect(decoded).toEqual(result);
  });

  it("rejects tampered results at consumer boundaries", () => {
    expect(UnitPricingResultSchema.safeParse({
      baseUnitPriceIdr: 120_000,
      discountPerUnitIdr: 12_000,
      finalUnitPriceIdr: 100_000,
    }).success).toBe(false);
    expect(OrderPricingResultSchema.safeParse({
      ...pricingGoldenCases[0].expected,
      totalIdr: 1,
    }).success).toBe(false);
    expect(DiscountPolicyResultSchema.safeParse({
      baseUnitPriceIdr: 120_000,
      discountPerUnitIdr: 0,
      finalUnitPriceIdr: 120_000,
      variableCostIdr: null,
      costQuality: "unknown",
      contributionPerUnitIdr: 0,
      warnings: [],
    }).success).toBe(false);
  });
});

describe("campaign discount planning policy", () => {
  it("accepts verified cost and calculates contribution", () => {
    const result = validateCampaignDiscount({ ...unitInput, variableCostIdr: 75_000, costQuality: "verified" });
    expect(result).toMatchObject({
      success: true,
      data: { finalUnitPriceIdr: 108_000, contributionPerUnitIdr: 33_000, warnings: [] },
    });
    if (result.success) expect(DiscountPolicyResultSchema.safeParse(result.data).success).toBe(true);
  });

  it("allows estimated cost with an explicit warning", () => {
    expect(validateCampaignDiscount({ ...unitInput, variableCostIdr: 75_000, costQuality: "estimated" }))
      .toMatchObject({ success: true, data: { contributionPerUnitIdr: 33_000, warnings: [{ code: "COST_ESTIMATED" }] } });
  });

  it("blocks proposed discounts with unknown cost", () => {
    expect(validateCampaignDiscount({ ...unitInput, variableCostIdr: null, costQuality: "unknown" }))
      .toMatchObject({ success: false, errors: [{ code: "COST_UNKNOWN" }] });
  });

  it("permits normal price with unknown contribution and a warning", () => {
    expect(validateCampaignDiscount({
      baseUnitPriceIdr: 120_000,
      offer: { offerType: "normal_price", discountBps: 0 },
      variableCostIdr: null,
      costQuality: "unknown",
    })).toMatchObject({ success: true, data: { contributionPerUnitIdr: null, warnings: [{ code: "COST_UNKNOWN" }] } });
  });

  it("distinguishes verified zero cost from unknown cost", () => {
    expect(validateCampaignDiscount({ ...unitInput, variableCostIdr: 0, costQuality: "verified" }))
      .toMatchObject({ success: true, data: { contributionPerUnitIdr: 108_000, warnings: [] } });
  });

  it.each([108_000, 120_000])("blocks nonpositive discounted contribution with cost %s", (variableCostIdr) => {
    expect(validateCampaignDiscount({ ...unitInput, variableCostIdr, costQuality: "verified" }))
      .toMatchObject({ success: false, errors: [{ code: "NONPOSITIVE_CONTRIBUTION" }] });
  });

  it.each([120_000, 150_000])("warns about nonpositive normal-price contribution with cost %s", (variableCostIdr) => {
    expect(validateCampaignDiscount({
      ...unitInput,
      offer: { offerType: "normal_price", discountBps: 0 },
      variableCostIdr,
      costQuality: "verified",
    })).toMatchObject({ success: true, data: { warnings: [{ code: "NONPOSITIVE_CONTRIBUTION" }] } });
  });

  it.each([
    { variableCostIdr: null, costQuality: "verified" },
    { variableCostIdr: null, costQuality: "estimated" },
    { variableCostIdr: 0, costQuality: "unknown" },
    { variableCostIdr: -1, costQuality: "verified" },
    { variableCostIdr: 1.5, costQuality: "verified" },
    { variableCostIdr: 1_000_000_001, costQuality: "verified" },
    { variableCostIdr: Number.MAX_SAFE_INTEGER + 1, costQuality: "verified" },
    { variableCostIdr: NaN, costQuality: "verified" },
    { variableCostIdr: 75_000, costQuality: "unverified" },
  ])("rejects inconsistent or invalid costs", (cost) => {
    const input = { ...unitInput, ...cost };
    expect(DiscountPolicyInputSchema.safeParse(input).success).toBe(false);
    expect(validateCampaignDiscount(input)).toMatchObject({
      success: false,
      errors: expect.arrayContaining([expect.objectContaining({ code: "INVALID_INPUT" })]),
    });
  });

  it("does not couple checkout pricing to updated planning costs", () => {
    const quote = calculateOrderPrice({ ...unitInput, quantity: 2 });
    expect(validateCampaignDiscount({ ...unitInput, variableCostIdr: 110_000, costQuality: "estimated" }))
      .toMatchObject({ success: false });
    expect(calculateOrderPrice({ ...unitInput, quantity: 2 })).toEqual(quote);
    expect(quote).toMatchObject({ success: true, data: { totalIdr: 216_000 } });
  });
});
