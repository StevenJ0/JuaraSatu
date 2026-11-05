import "server-only";
import { z } from "zod";
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import type { PaymentCharge, VerifiedPaymentFact } from "@/features/payments/schemas";

export const PAYMENT_VIOLATIONS = ["VALIDATION_ERROR", "ORDER_NOT_FOUND", "ORDER_STATE_INVALID", "PAYMENT_NOT_FOUND"] as const;
export type PaymentViolation = (typeof PAYMENT_VIOLATIONS)[number];

function parseViolation(message: string): PaymentViolation | null {
  return PAYMENT_VIOLATIONS.find((violation) => message.includes(violation)) ?? null;
}

export class PaymentRepositoryError extends Error {
  constructor(
    operation: string,
    readonly code: string | undefined,
    readonly violation: PaymentViolation | null,
  ) {
    super(`Payment repository gagal: ${operation}${code ? ` (${code})` : ""}`);
    this.name = "PaymentRepositoryError";
  }
}

function fail(operation: string, error: PostgrestError): never {
  throw new PaymentRepositoryError(operation, error.code, parseViolation(error.message));
}

const PAYMENT_STATUSES = ["initiating", "pending", "paid_sandbox", "expired", "failed", "cancelled"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

const paymentAttemptSchema = z.object({
  payment_id: z.uuid(),
  provider_order_id: z.string(),
  attempt_number: z.number(),
  amount_idr: z.number(),
  status: z.enum(PAYMENT_STATUSES),
  qr_content: z.string().nullable(),
  qr_expires_at: z.string().nullable(),
  reused: z.boolean(),
});

export type PaymentAttempt = {
  paymentId: string;
  providerOrderId: string;
  attemptNumber: number;
  amountIdr: number;
  status: PaymentStatus;
  qrContent: string | null;
  qrExpiresAt: string | null;
  /** True berarti percobaan aktif dipakai ulang: jangan membuat tagihan baru bila `qrContent` sudah ada. */
  reused: boolean;
};

export async function claimPaymentAttemptRecord(client: SupabaseClient, tokenHash: string): Promise<PaymentAttempt> {
  const { data, error } = await client.rpc("claim_payment_attempt", { p_token_hash: tokenHash });
  if (error) fail("claimPaymentAttempt", error);
  const row = paymentAttemptSchema.parse(data);
  return {
    paymentId: row.payment_id,
    providerOrderId: row.provider_order_id,
    attemptNumber: row.attempt_number,
    amountIdr: row.amount_idr,
    status: row.status,
    qrContent: row.qr_content,
    qrExpiresAt: row.qr_expires_at,
    reused: row.reused,
  };
}

export async function recordPaymentChargeRecord(client: SupabaseClient, charge: PaymentCharge): Promise<boolean> {
  const { data, error } = await client.rpc("record_payment_charge", {
    p_payment_id: charge.paymentId,
    p_provider_transaction_id: charge.providerTransactionId,
    p_qr_content: charge.qrContent,
    p_qr_expires_at: charge.qrExpiresAt,
  });
  if (error) fail("recordPaymentCharge", error);
  return z.boolean().parse(data);
}

const applyResultSchema = z.object({
  outcome: z.enum(["applied", "duplicate", "review", "recorded", "ignored", "amount_mismatch"]),
  payment_id: z.uuid(),
  order_id: z.uuid(),
  order_status: z.string(),
});

export type ApplyPaymentResult = {
  outcome: z.infer<typeof applyResultSchema>["outcome"];
  paymentId: string;
  orderId: string;
  orderStatus: string;
};

export async function applyVerifiedPaymentRecord(client: SupabaseClient, fact: VerifiedPaymentFact): Promise<ApplyPaymentResult> {
  const { data, error } = await client.rpc("apply_verified_payment", {
    p_provider_order_id: fact.providerOrderId,
    p_provider_event_key: fact.providerEventKey,
    p_payload_hash: fact.payloadHash,
    p_provider_status: fact.providerStatus,
    p_provider_transaction_id: fact.providerTransactionId,
    p_amount_idr: fact.amountIdr,
    p_provider_paid_at: fact.providerPaidAt,
  });
  if (error) fail("applyVerifiedPayment", error);
  const row = applyResultSchema.parse(data);
  return { outcome: row.outcome, paymentId: row.payment_id, orderId: row.order_id, orderStatus: row.order_status };
}

const orderPaymentRowSchema = z.object({
  id: z.uuid(),
  attempt_number: z.number(),
  amount_idr: z.number(),
  status: z.enum(PAYMENT_STATUSES),
  provider_paid_at: z.string().nullable(),
  applied_at: z.string().nullable(),
  review_reason: z.string().nullable(),
});

export type OrderPayment = {
  id: string;
  attemptNumber: number;
  amountIdr: number;
  status: PaymentStatus;
  providerPaidAt: string | null;
  appliedAt: string | null;
  reviewReason: string | null;
};

/** Untuk halaman pemilik, lewat client bersesi agar RLS tetap berlaku. */
export async function listOrderPayments(client: SupabaseClient, businessId: string, orderId: string): Promise<OrderPayment[]> {
  const { data, error } = await client
    .from("payments")
    .select("id, attempt_number, amount_idr, status, provider_paid_at, applied_at, review_reason")
    .eq("business_id", businessId)
    .eq("order_id", orderId)
    .order("attempt_number", { ascending: true });
  if (error) fail("listOrderPayments", error);
  return z
    .array(orderPaymentRowSchema)
    .parse(data)
    .map((row) => ({
      id: row.id,
      attemptNumber: row.attempt_number,
      amountIdr: row.amount_idr,
      status: row.status,
      providerPaidAt: row.provider_paid_at,
      appliedAt: row.applied_at,
      reviewReason: row.review_reason,
    }));
}
