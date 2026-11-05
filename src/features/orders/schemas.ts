import { z } from "zod";
import { positiveUnits } from "@/features/preorders/schemas";

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
  expectedUnitPriceIdr: z.number().int().positive(),
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
});

export const acceptLatePaymentSchema = orderRefSchema.extend({ paymentId: z.uuid() });

export const declineLatePaymentSchema = orderRefSchema.extend({
  note: z.string().trim().min(1, "Tulis catatan tindak lanjut").max(CANCEL_REASON_MAX, `Maksimal ${CANCEL_REASON_MAX} karakter`),
});
