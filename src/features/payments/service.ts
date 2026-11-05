import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { privateOrderTokenSchema } from "@/features/orders/schemas";
import { hashPrivateOrderToken } from "@/features/orders/service";
import {
  PaymentRepositoryError,
  applyVerifiedPaymentRecord,
  claimPaymentAttemptRecord,
  recordPaymentChargeRecord,
  type ApplyPaymentResult,
  type PaymentAttempt,
  type PaymentViolation,
} from "@/features/payments/repository";
import type { PaymentCharge, VerifiedPaymentFact } from "@/features/payments/schemas";

/**
 * Kontrak C5 untuk adapter Midtrans. Semua fungsi di sini wajib memakai client service role dan tidak memanggil provider.
 * Urutan pakainya: `claimPaymentAttempt`, panggil Midtrans di luar transaksi, `recordPaymentCharge`, lalu webhook atau
 * rekonsiliasi memanggil `applyVerifiedPayment` dengan fakta yang sudah diverifikasi.
 */
export type PaymentOutcome<Value> = { kind: "ok"; value: Value } | { kind: "rejected"; violation: PaymentViolation };

async function toOutcome<Value>(run: () => Promise<Value>): Promise<PaymentOutcome<Value>> {
  try {
    return { kind: "ok", value: await run() };
  } catch (error) {
    if (error instanceof PaymentRepositoryError && error.violation) return { kind: "rejected", violation: error.violation };
    throw error;
  }
}

/** Token salah dan token tidak berbentuk token sama-sama ORDER_NOT_FOUND. Dua tab mendapat percobaan yang sama. */
export async function claimPaymentAttempt(client: SupabaseClient, token: string): Promise<PaymentOutcome<PaymentAttempt>> {
  const parsed = privateOrderTokenSchema.safeParse(token);
  if (!parsed.success) return { kind: "rejected", violation: "ORDER_NOT_FOUND" };
  return toOutcome(() => claimPaymentAttemptRecord(client, hashPrivateOrderToken(parsed.data)));
}

/** Hasil false berarti percobaan sudah tidak aktif, misalnya webhook lunas datang lebih dulu. Ini bukan kesalahan. */
export function recordPaymentCharge(client: SupabaseClient, charge: PaymentCharge): Promise<PaymentOutcome<boolean>> {
  return toOutcome(() => recordPaymentChargeRecord(client, charge));
}

/** Satu-satunya penulis status pembayaran. Mengulang event yang sama aman dan hasilnya `duplicate`. */
export function applyVerifiedPayment(client: SupabaseClient, fact: VerifiedPaymentFact): Promise<PaymentOutcome<ApplyPaymentResult>> {
  return toOutcome(() => applyVerifiedPaymentRecord(client, fact));
}
