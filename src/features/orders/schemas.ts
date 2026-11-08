import { z } from "zod";
import { positiveUnits } from "@/features/preorders/schemas";
import { parseIdr } from "@/features/products/schemas";
import { MAX_MONEY_IDR } from "@/features/pricing/contracts";

const CUSTOMER_NAME_MAX = 160;
const CUSTOMER_EMAIL_MAX = 254;
const CUSTOMER_CONTACT_MAX = 120;
const CANCEL_REASON_MAX = 500;

const customerName = z.string().trim().min(1, "Nama pemesan wajib diisi").max(CUSTOMER_NAME_MAX, `Maksimal ${CUSTOMER_NAME_MAX} karakter`);
const customerContact = z
  .string()
  .trim()
  .max(CUSTOMER_CONTACT_MAX, `Maksimal ${CUSTOMER_CONTACT_MAX} karakter`)
  .transform((value) => (value === "" ? null : value));

/** Email wajib untuk checkout pembeli, boleh kosong untuk pesanan manual (PRD §Contact). */
const requiredEmail = z.string().trim().toLowerCase().max(CUSTOMER_EMAIL_MAX).pipe(z.email("Format email tidak valid"));
const optionalEmail = z
  .string()
  .trim()
  .toLowerCase()
  .max(CUSTOMER_EMAIL_MAX, "Email terlalu panjang")
  .refine((value) => value === "" || z.email().safeParse(value).success, "Format email tidak valid")
  .transform((value) => (value === "" ? null : value));

export const manualOrderSchema = z.object({
  preorderId: z.uuid(),
  idempotencyKey: z.uuid(),
  customerName,
  customerEmail: optionalEmail,
  customerContact,
  quantity: positiveUnits("Isi jumlah dengan angka bulat, minimal 1"),
  paymentStatus: z.enum(["paid", "unpaid"], { error: "Pilih status pembayaran" }),
});
export type ManualOrderInput = z.output<typeof manualOrderSchema>;
export const MANUAL_ORDER_FIELDS = [
  "preorderId",
  "idempotencyKey",
  "customerName",
  "customerEmail",
  "customerContact",
  "quantity",
  "paymentStatus",
] as const;

/** PRD §9.2: pesanan manual boleh di luar preorder, langsung memakai kapasitas jadwal yang dipilih. */
export const standaloneManualOrderSchema = manualOrderSchema.omit({ preorderId: true }).extend({
  capacityId: z.uuid({ error: "Pilih jadwal produksi" }),
});
export type StandaloneManualOrderInput = z.output<typeof standaloneManualOrderSchema>;
export const STANDALONE_MANUAL_ORDER_FIELDS = [
  "capacityId",
  "idempotencyKey",
  "customerName",
  "customerEmail",
  "customerContact",
  "quantity",
  "paymentStatus",
] as const;

export const privateOrderTokenSchema = z.string().min(32).max(256);

/** Kontrak C4 untuk checkout pembeli. Browser tidak menentukan harga, total, business, atau status. */
export const publicOrderSchema = z.object({
  slug: z.string().trim().min(1),
  idempotencyKey: z.string().trim().min(16).max(128),
  privateToken: privateOrderTokenSchema,
  customerName,
  customerEmail: requiredEmail,
  customerContact,
  quantity: z.number().int().min(1).max(10_000),
  expectedUnitPriceIdr: z.number().int().positive().max(MAX_MONEY_IDR),
  /** Referensi tautan kampanye. Hanya mencatat asal pesanan, tidak mengubah harga. */
  attributionRef: z.string().trim().min(1).max(200).nullable().default(null),
});
export type PublicOrderInput = z.output<typeof publicOrderSchema>;

export const ORDER_ACTIONS = ["mark_paid", "confirm", "start_production", "mark_ready", "fulfill"] as const;
export type OrderAction = (typeof ORDER_ACTIONS)[number];

export const orderRefSchema = z.object({
  orderId: z.uuid(),
  version: z.coerce.number().int().min(1),
});

export const orderActionSchema = orderRefSchema.extend({ action: z.enum(ORDER_ACTIONS) });

export const cancelOrderSchema = orderRefSchema.extend({
  reason: z.string().trim().min(1, "Tulis alasan pembatalan").max(CANCEL_REASON_MAX, `Maksimal ${CANCEL_REASON_MAX} karakter`),
  /** Wajib bila pesanan sudah lunas. Aturannya di database, karena hanya database yang tahu status bayar terbaru. */
  refundNote: z
    .string()
    .trim()
    .max(CANCEL_REASON_MAX, `Maksimal ${CANCEL_REASON_MAX} karakter`)
    .transform((value) => (value === "" ? null : value)),
});

export const RESOLVABLE_COST_QUALITIES = ["estimated", "verified"] as const;

export const resolveProductionCostSchema = orderRefSchema
  .extend({
    // Kosong dicek di sini, bukan di transform, agar pesannya muncul bersama galat kolom lain.
    costPerUnit: z.string().trim().min(1, "Isi biaya per unit dalam rupiah, boleh Rp0"),
    quality: z.enum(RESOLVABLE_COST_QUALITIES, { error: "Pilih status biaya" }),
    note: z.string().trim().min(1, "Tulis catatan asal biaya").max(CANCEL_REASON_MAX, `Maksimal ${CANCEL_REASON_MAX} karakter`),
  })
  .transform(({ costPerUnit, ...fields }, context) => {
    const costPerUnitIdr = parseIdr(costPerUnit);
    if (costPerUnitIdr === null) {
      context.addIssue({ code: "custom", path: ["costPerUnit"], message: "Isi biaya per unit dalam rupiah, boleh Rp0" });
      return z.NEVER;
    }
    return { ...fields, costPerUnitIdr };
  });

export const acceptLatePaymentSchema = orderRefSchema.extend({ paymentId: z.uuid() });

export const declineLatePaymentSchema = orderRefSchema.extend({
  note: z.string().trim().min(1, "Tulis catatan tindak lanjut").max(CANCEL_REASON_MAX, `Maksimal ${CANCEL_REASON_MAX} karakter`),
});
