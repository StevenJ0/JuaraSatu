import { z } from "zod";

/**
 * Fakta dari provider yang sudah diverifikasi adapter (signature, nominal, referensi, environment).
 * `providerStatus` adalah nilai mentah Midtrans, dan pemetaannya ada di `apply_verified_payment`.
 */
export const verifiedPaymentFactSchema = z.object({
  providerOrderId: z.string().min(1).max(120),
  /** Identitas event untuk dedupe, misalnya `transaction_id:transaction_status`. Bukan order_id saja, karena pending dan settlement adalah event berbeda. */
  providerEventKey: z.string().min(1).max(200),
  payloadHash: z.string().min(1).max(128),
  providerStatus: z.string().min(1).max(40),
  providerTransactionId: z.string().min(1).max(120).nullable(),
  amountIdr: z.number().int().nonnegative(),
  providerPaidAt: z.iso.datetime({ offset: true }).nullable(),
});
export type VerifiedPaymentFact = z.output<typeof verifiedPaymentFactSchema>;

export const paymentChargeSchema = z.object({
  paymentId: z.uuid(),
  providerTransactionId: z.string().min(1).max(120).nullable(),
  qrContent: z.string().min(1),
  qrExpiresAt: z.iso.datetime({ offset: true }).nullable(),
});
export type PaymentCharge = z.output<typeof paymentChargeSchema>;
