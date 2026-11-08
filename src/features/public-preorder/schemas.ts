import { z } from "zod";
import { publicOrderSchema } from "@/features/orders/schemas";
import { positiveUnits } from "@/features/preorders/schemas";

export const CHECKOUT_FIELDS = [
  "slug",
  "idempotencyKey",
  "privateToken",
  "customerName",
  "customerEmail",
  "customerContact",
  "quantity",
  "expectedUnitPriceIdr",
  "attributionRef",
] as const;
export type CheckoutField = (typeof CHECKOUT_FIELDS)[number];

/** Isian form selalu teks. Angka diubah di sini, lalu tetap melewati aturan C4 yang sama dengan `placePublicOrder`. */
export const checkoutFormSchema = publicOrderSchema.extend({
  quantity: positiveUnits("Isi jumlah dengan angka bulat, minimal 1"),
  expectedUnitPriceIdr: z
    .string()
    .regex(/^[1-9]\d*$/)
    .transform(Number)
    .pipe(publicOrderSchema.shape.expectedUnitPriceIdr),
  attributionRef: z
    .string()
    .trim()
    .max(200)
    .transform((value) => (value === "" ? null : value)),
});
