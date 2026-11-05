import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PrivateOrderStatus } from "@/features/orders/private-status";
import { privateOrderTokenSchema, type ManualOrderInput, type OrderAction, type PublicOrderInput } from "@/features/orders/schemas";
import {
  OrderRepositoryError,
  acceptLatePaymentRecord,
  advanceOrder,
  closeOrder,
  createManualOrderRecord,
  createPublicOrderRecord,
  declineLatePaymentRecord,
  findOrderByTokenHash,
  type OrderResult,
  type OrderViolation,
} from "@/features/orders/repository";

// Nilai sementara. Angka final mengikuti batas QR Midtrans dari uji Indro (PRD §9.3), lalu cukup diganti lewat environment.
const DEFAULT_HOLD_TTL_SECONDS = 15 * 60;
const MAX_HOLD_TTL_SECONDS = 24 * 60 * 60;
const PRIVATE_TOKEN_BYTES = 32;

const holdTtlSchema = z.coerce.number().int().min(1).max(MAX_HOLD_TTL_SECONDS);

export function resolveHoldTtlSeconds(raw: string | undefined): number {
  const parsed = holdTtlSchema.safeParse(raw);
  return raw !== undefined && raw !== "" && parsed.success ? parsed.data : DEFAULT_HOLD_TTL_SECONDS;
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** Token mentah hanya untuk browser pembeli. Yang disimpan server hanya hash-nya, sehingga tidak bisa diterbitkan ulang. */
export function createPrivateOrderToken(): string {
  return randomBytes(PRIVATE_TOKEN_BYTES).toString("base64url");
}

export function hashPrivateOrderToken(token: string): string {
  return sha256(token);
}

/** Kunci sama dengan isi berbeda harus ditolak, jadi hash dihitung dari isi permintaan yang sudah dinormalkan. */
export function hashOrderRequest(payload: Record<string, string | number | boolean | null>): string {
  const canonical = Object.keys(payload)
    .sort()
    .map((key) => [key, payload[key]]);
  return sha256(JSON.stringify(canonical));
}

export type OrderOutcome<Value> = { kind: "ok"; value: Value } | { kind: "rejected"; violation: OrderViolation };

async function toOutcome<Value>(run: () => Promise<Value>): Promise<OrderOutcome<Value>> {
  try {
    return { kind: "ok", value: await run() };
  } catch (error) {
    if (error instanceof OrderRepositoryError && error.violation) return { kind: "rejected", violation: error.violation };
    throw error;
  }
}

export function createManualOrder(client: SupabaseClient, input: ManualOrderInput): Promise<OrderOutcome<OrderResult>> {
  const requestHash = hashOrderRequest({
    preorderId: input.preorderId,
    quantity: input.quantity,
    customerName: input.customerName,
    customerEmail: input.customerEmail,
    customerContact: input.customerContact,
    paymentStatus: input.paymentStatus,
  });
  return toOutcome(() => createManualOrderRecord(client, input, requestHash));
}

/**
 * Kontrak C4 untuk checkout pembeli. `client` wajib service role karena pembeli tidak punya akun.
 * Kirim ulang dengan kunci dan token yang sama mengembalikan pesanan yang sama, sehingga respons yang hilang aman diulang.
 */
export function placePublicOrder(
  client: SupabaseClient,
  input: PublicOrderInput,
  holdTtlSeconds: number = resolveHoldTtlSeconds(process.env.ORDER_HOLD_TTL_SECONDS),
): Promise<OrderOutcome<OrderResult>> {
  const requestHash = hashOrderRequest({
    slug: input.slug,
    quantity: input.quantity,
    customerName: input.customerName,
    customerEmail: input.customerEmail,
    customerContact: input.customerContact,
    expectedUnitPriceIdr: input.expectedUnitPriceIdr,
  });
  return toOutcome(() =>
    createPublicOrderRecord(client, {
      slug: input.slug,
      quantity: input.quantity,
      customerName: input.customerName,
      customerEmail: input.customerEmail,
      customerContact: input.customerContact,
      tokenHash: hashPrivateOrderToken(input.privateToken),
      idempotencyKey: input.idempotencyKey,
      requestHash,
      expectedUnitPriceIdr: input.expectedUnitPriceIdr,
      holdTtlSeconds,
    }),
  );
}

/**
 * Kontrak C4 untuk halaman lacak. `client` wajib service role. Token salah atau tidak berbentuk token sama-sama null,
 * sehingga tidak ada beda antara pesanan yang tidak ada dan token yang salah. Hanya hash yang dikirim ke database.
 */
export async function findOrderByPrivateToken(client: SupabaseClient, token: string, now: Date = new Date()): Promise<PrivateOrderStatus | null> {
  const parsed = privateOrderTokenSchema.safeParse(token);
  return parsed.success ? findOrderByTokenHash(client, hashPrivateOrderToken(parsed.data), now) : null;
}

export function runOrderAction(client: SupabaseClient, orderId: string, version: number, action: OrderAction): Promise<OrderOutcome<void>> {
  return toOutcome(() => advanceOrder(client, orderId, version, action));
}

export function cancelOrder(client: SupabaseClient, orderId: string, version: number, reason: string): Promise<OrderOutcome<void>> {
  return toOutcome(() => closeOrder(client, orderId, version, "cancel", reason));
}

/** Kapasitas dan kuota dicek ulang di database, jadi penolakan `CAPACITY_UNAVAILABLE` berarti slotnya sudah terpakai pesanan lain. */
export function acceptLatePayment(client: SupabaseClient, orderId: string, version: number, paymentId: string): Promise<OrderOutcome<void>> {
  return toOutcome(() => acceptLatePaymentRecord(client, orderId, version, paymentId));
}

export function declineLatePayment(client: SupabaseClient, orderId: string, version: number, note: string): Promise<OrderOutcome<void>> {
  return toOutcome(() => declineLatePaymentRecord(client, orderId, version, note));
}

/** Slot yang tenggatnya lewat sudah tidak dihitung; ini hanya merapikan status dan aman diulang. */
export function expireOrder(client: SupabaseClient, orderId: string, version: number | null): Promise<OrderOutcome<void>> {
  return toOutcome(() => closeOrder(client, orderId, version, "expire", null));
}
