import type { z } from "zod";
import {
  DiscountPolicyInputSchema,
  MAX_MONEY_IDR,
  OrderPricingInputSchema,
  UnitPricingInputSchema,
  type DiscountPolicyResult,
  type OrderPricingResult,
  type PricingFailure,
  type PricingResult,
  type PricingWarning,
  type UnitPricingInput,
  type UnitPricingResult,
} from "./contracts";

function invalidInput(error: z.ZodError): PricingFailure {
  return {
    success: false,
    errors: error.issues.map((issue) => ({
      code: "INVALID_INPUT",
      field: issue.path.map(String).join(".") || "input",
      message: issue.message,
    })),
  };
}

function unitPrice(input: UnitPricingInput): UnitPricingResult {
  const base = BigInt(input.baseUnitPriceIdr);
  const discount = (base * BigInt(input.offer.discountBps)) / BigInt(10_000);
  return {
    baseUnitPriceIdr: input.baseUnitPriceIdr,
    discountPerUnitIdr: Number(discount),
    finalUnitPriceIdr: Number(base - discount),
  };
}

/** Caller supplies the preorder's frozen base price, never an already-discounted price. */
export function calculateUnitPrice(
  input: unknown,
): PricingResult<UnitPricingResult> {
  const parsed = UnitPricingInputSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  return { success: true, data: unitPrice(parsed.data) };
}

export function calculateOrderPrice(
  input: unknown,
): PricingResult<OrderPricingResult> {
  const parsed = OrderPricingInputSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);

  const price = unitPrice(parsed.data);
  const quantity = BigInt(parsed.data.quantity);
  const subtotal = BigInt(price.baseUnitPriceIdr) * quantity;
  // Bounding the subtotal also bounds both the discount and the final total.
  if (subtotal > BigInt(MAX_MONEY_IDR)) {
    return {
      success: false,
      errors: [
        {
          code: "AMOUNT_OUT_OF_RANGE",
          field: "subtotalIdr",
          message: "Subtotal pesanan melebihi batas Rp1.000.000.000.",
        },
      ],
    };
  }

  return {
    success: true,
    data: {
      ...price,
      quantity: parsed.data.quantity,
      subtotalIdr: Number(subtotal),
      discountTotalIdr: Number(BigInt(price.discountPerUnitIdr) * quantity),
      totalIdr: Number(BigInt(price.finalUnitPriceIdr) * quantity),
    },
  };
}

/** Planning/approval guard only; do not revalidate an existing checkout against new costs. */
export function validateCampaignDiscount(
  input: unknown,
): PricingResult<DiscountPolicyResult> {
  const parsed = DiscountPolicyInputSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);

  const { data } = parsed;
  const price = unitPrice(data);
  const contributionPerUnitIdr =
    data.variableCostIdr === null
      ? null
      : price.finalUnitPriceIdr - data.variableCostIdr;

  if (data.offer.offerType === "percent_discount") {
    if (contributionPerUnitIdr === null) {
      return {
        success: false,
        errors: [
          {
            code: "COST_UNKNOWN",
            field: "variableCostIdr",
            message: "Biaya variabel harus diketahui sebelum menyetujui diskon.",
          },
        ],
      };
    }
    if (contributionPerUnitIdr <= 0) {
      return {
        success: false,
        errors: [
          {
            code: "NONPOSITIVE_CONTRIBUTION",
            field: "variableCostIdr",
            message: "Diskon harus menyisakan kontribusi per unit yang positif.",
          },
        ],
      };
    }
  }

  const warnings: PricingWarning[] = [];
  if (data.costQuality === "unknown") {
    warnings.push({
      code: "COST_UNKNOWN",
      message: "Biaya dan kontribusi per unit belum diketahui.",
    });
  }
  if (data.costQuality === "estimated") {
    warnings.push({
      code: "COST_ESTIMATED",
      message: "Kontribusi menggunakan estimasi biaya variabel.",
    });
  }
  if (contributionPerUnitIdr !== null && contributionPerUnitIdr <= 0) {
    warnings.push({
      code: "NONPOSITIVE_CONTRIBUTION",
      message: "Harga normal tidak menyisakan kontribusi per unit yang positif.",
    });
  }

  return {
    success: true,
    data: {
      ...price,
      costQuality: data.costQuality,
      variableCostIdr: data.variableCostIdr,
      contributionPerUnitIdr,
      warnings,
    },
  };
}
