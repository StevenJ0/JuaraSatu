import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { findOrderByPrivateToken } from "@/features/orders/service";
import {
  MidtransSandboxError,
  createMidtransSandboxClient,
  parseMidtransSandboxConfig,
  sandboxQrImageUrl,
  verifyMidtransNotification,
  type MidtransSandboxConfig,
  type SandboxStatus,
  type SandboxTransaction,
} from "@/features/payments/midtrans-sandbox";
import type { ApplyPaymentResult, PaymentAttempt } from "@/features/payments/repository";
import { applyVerifiedPayment, claimPaymentAttempt, recordPaymentCharge, type PaymentOutcome } from "@/features/payments/service";

/** Bagian adapter Midtrans yang dipakai di sini. Uji mengganti transport-nya, bukan aturan di file ini. */
export type QrisGateway = Pick<ReturnType<typeof createMidtransSandboxClient>, "createQris" | "getStatus">;

/** Yang boleh ditampilkan ke pembeli. Tidak membawa ID internal, server key, atau respons mentah provider. */
export type QrisView =
  | { kind: "qr"; qrImageUrl: string; expiresAt: string | null; amountIdr: number }
  | { kind: "paid" }
  /** Status final dari provider baru diterapkan. Muat ulang halaman, karena status yang benar ada di database. */
  | { kind: "updated" }
  /** Pembayaran sudah dibuat atau sedang dicek. Coba lagi sebentar lagi, jangan membuat tagihan baru. */
  | { kind: "processing" }
  | { kind: "closed" }
  | { kind: "not_found" }
  | { kind: "provider_unavailable" };

function canonicalHash(transaction: SandboxTransaction): string {
  // Webhook dan cek manual menghasilkan hash yang sama untuk fakta yang sama, jadi ulangan tercatat `duplicate` biasa.
  const canonical = [
    transaction.providerOrderId,
    transaction.providerTransactionId,
    transaction.providerStatus,
    transaction.providerStatusCode,
    transaction.amountIdr,
    transaction.providerPaidAt,
  ];
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

/** Fakta dari GET Status server-ke-server. Hanya ini yang diteruskan ke `applyVerifiedPayment`, bukan isi notifikasi atau klaim browser. */
function applyTransaction(client: SupabaseClient, transaction: SandboxTransaction): Promise<PaymentOutcome<ApplyPaymentResult>> {
  return applyVerifiedPayment(client, {
    providerOrderId: transaction.providerOrderId,
    providerEventKey: `${transaction.providerTransactionId}:${transaction.providerStatus}`,
    payloadHash: canonicalHash(transaction),
    providerStatus: transaction.providerStatus,
    providerTransactionId: transaction.providerTransactionId,
    amountIdr: transaction.amountIdr,
    providerPaidAt: transaction.providerPaidAt,
  });
}

async function readStatus(gateway: QrisGateway, attempt: PaymentAttempt): Promise<SandboxStatus | null> {
  try {
    return await gateway.getStatus({ providerOrderId: attempt.providerOrderId, amountIdr: attempt.amountIdr });
  } catch (error) {
    if (error instanceof MidtransSandboxError) return null;
    throw error;
  }
}

/** Percobaan yang sudah ada di provider: tampilkan QR bila masih menunggu, terapkan fakta bila sudah final. */
async function settleExisting(client: SupabaseClient, gateway: QrisGateway, attempt: PaymentAttempt): Promise<QrisView> {
  const status = await readStatus(gateway, attempt);
  if (status === null) return { kind: "provider_unavailable" };
  // Satu kali 404 bukan izin membuat tagihan baru (kontrak C5 §4.7). Pembeli menunggu, pesanan kedaluwarsa sesuai tenggat.
  if (status.kind === "not_found") return { kind: "processing" };
  const transaction = status.transaction;
  if (transaction.providerStatus === "pending") {
    const qrImageUrl = attempt.qrContent ?? sandboxQrImageUrl(transaction.providerTransactionId);
    if (attempt.qrContent === null) {
      await recordPaymentCharge(client, { paymentId: attempt.paymentId, providerTransactionId: transaction.providerTransactionId, qrContent: qrImageUrl, qrExpiresAt: transaction.expiresAt });
    }
    return { kind: "qr", qrImageUrl, expiresAt: transaction.expiresAt ?? attempt.qrExpiresAt, amountIdr: attempt.amountIdr };
  }
  await applyTransaction(client, transaction);
  return { kind: "updated" };
}

/**
 * Lanjutkan pembayaran QRIS untuk pemegang token privat (FR-PAY-01/02). Hanya `create_charge` yang boleh membuat tagihan, dan
 * tagihan dibuat di luar transaksi database. `checkStatus` dipakai tombol "cek status": membaca status provider, bukan membuat tagihan.
 */
export async function continueQrisPayment(
  client: SupabaseClient,
  gateway: QrisGateway,
  token: string,
  { checkStatus }: { checkStatus: boolean },
): Promise<QrisView> {
  const order = await findOrderByPrivateToken(client, token);
  if (order === null) return { kind: "not_found" };
  if (order.paymentState === "applied") return { kind: "paid" };
  if (!order.canContinuePayment || order.paymentDueAt === null) return { kind: "closed" };

  const claimed = await claimPaymentAttempt(client, token);
  if (claimed.kind === "rejected") return claimed.violation === "ORDER_NOT_FOUND" ? { kind: "not_found" } : { kind: "closed" };
  const attempt = claimed.value;

  switch (attempt.action) {
    case "wait":
      return { kind: "processing" };
    case "reconcile":
      return settleExisting(client, gateway, attempt);
    case "reuse_qr":
      if (checkStatus || attempt.qrContent === null) return settleExisting(client, gateway, attempt);
      return { kind: "qr", qrImageUrl: attempt.qrContent, expiresAt: attempt.qrExpiresAt, amountIdr: attempt.amountIdr };
    case "create_charge":
      try {
        const qris = await gateway.createQris({ providerOrderId: attempt.providerOrderId, amountIdr: attempt.amountIdr, paymentDueAt: order.paymentDueAt });
        await recordPaymentCharge(client, { paymentId: attempt.paymentId, providerTransactionId: qris.providerTransactionId, qrContent: qris.qrImageUrl, qrExpiresAt: qris.expiresAt });
        return { kind: "qr", qrImageUrl: qris.qrImageUrl, expiresAt: qris.expiresAt, amountIdr: attempt.amountIdr };
      } catch (error) {
        // Referensi tetap tersimpan. Percobaan berikutnya mendapat `reconcile`, lalu status dicek dengan referensi yang sama.
        if (error instanceof MidtransSandboxError) return { kind: "provider_unavailable" };
        throw error;
      }
  }
}

export type NotificationResponse = { status: number; body: { result: string } };

const MAX_NOTIFICATION_BYTES = 65_536;

/**
 * Webhook Midtrans (FR-PAY-03). Signature salah ditolak tanpa menulis apa pun. Notifikasi sah tetap dicek ulang lewat GET Status,
 * dan hanya fakta dari status itu yang diterapkan. Status 5xx membuat Midtrans mengirim ulang, jadi hanya dipakai untuk gangguan sementara.
 */
export async function handleMidtransNotification(
  client: SupabaseClient,
  gateway: QrisGateway,
  config: MidtransSandboxConfig,
  rawBody: string,
): Promise<NotificationResponse> {
  if (rawBody.length > MAX_NOTIFICATION_BYTES) return { status: 413, body: { result: "too_large" } };
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return { status: 400, body: { result: "invalid" } };
  }
  const notification = verifyMidtransNotification(config, payload);
  if (notification === null) return { status: 401, body: { result: "invalid_signature" } };

  let status: SandboxStatus;
  try {
    status = await gateway.getStatus({ providerOrderId: notification.providerOrderId, amountIdr: notification.amountIdr, providerTransactionId: notification.providerTransactionId });
  } catch (error) {
    if (!(error instanceof MidtransSandboxError)) throw error;
    // Nominal atau referensi beda dari status provider: bukan gangguan sementara, jadi tidak diulang dan tidak ditulis.
    if (error.code === "AMOUNT_MISMATCH" || error.code === "REFERENCE_MISMATCH") return { status: 400, body: { result: "mismatch" } };
    // Status provider di luar QRIS yang dikenal (misalnya refund parsial) tidak diterapkan ke pesanan.
    if (error.code === "INVALID_PROVIDER_RESPONSE") return { status: 200, body: { result: "ignored" } };
    return { status: 503, body: { result: "retry" } };
  }
  if (status.kind === "not_found") return { status: 404, body: { result: "not_found" } };

  const outcome = await applyTransaction(client, status.transaction);
  if (outcome.kind === "rejected") return { status: 404, body: { result: "not_found" } };
  return { status: 200, body: { result: outcome.value.outcome } };
}

/** Null bila server key Sandbox tim belum diisi atau bentuknya salah. Pembayaran lalu tampil belum tersedia, bukan error. */
export function loadMidtransSandbox(): { config: MidtransSandboxConfig; gateway: QrisGateway } | null {
  try {
    const config = parseMidtransSandboxConfig(process.env);
    return { config, gateway: createMidtransSandboxClient(config) };
  } catch (error) {
    if (error instanceof MidtransSandboxError) return null;
    throw error;
  }
}
