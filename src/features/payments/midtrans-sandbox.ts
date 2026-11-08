import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";

// Never accept a caller-provided base URL or follow redirects with the server key.
const SANDBOX_URL = "https://api.sandbox.midtrans.com";
const MAX_RESPONSE_LENGTH = 65_536;
const referenceSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,50}$/);
const amountSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const configSchema = z.object({
  serverKey: z.string().regex(/^SB-Mid-server-[a-zA-Z0-9_-]+$/),
  merchantId: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),
  acquirer: z.enum(["gopay", "airpay shopee"]),
});

export type MidtransSandboxConfig = z.infer<typeof configSchema>;
export type MidtransErrorCode =
  | "INVALID_CONFIGURATION"
  | "INVALID_REQUEST"
  | "PROVIDER_UNAVAILABLE"
  | "PROVIDER_REJECTED"
  | "INVALID_PROVIDER_RESPONSE"
  | "REFERENCE_MISMATCH"
  | "AMOUNT_MISMATCH"
  | "EXPIRY_UNCONFIRMED";
type Operation = "configuration" | "create" | "status";

/** Safe metadata only: never attach the request, authorization, raw response, or original error. */
export class MidtransSandboxError extends Error {
  readonly code: MidtransErrorCode;
  readonly operation: Operation;
  readonly reconciliationRequired: boolean;

  constructor(code: MidtransErrorCode, operation: Operation) {
    super(`Midtrans Sandbox: ${code}`);
    this.name = "MidtransSandboxError";
    this.code = code;
    this.operation = operation;
    // A failed POST response does not prove the provider failed to create a transaction.
    this.reconciliationRequired = operation === "create" && code !== "INVALID_REQUEST";
  }
}

export function parseMidtransSandboxConfig(source: Record<string, string | undefined>): MidtransSandboxConfig {
  const result = configSchema.safeParse({
    serverKey: source.MIDTRANS_SERVER_KEY,
    merchantId: source.MIDTRANS_MERCHANT_ID,
    acquirer: source.MIDTRANS_QRIS_ACQUIRER ?? "gopay",
  });
  if (!result.success) throw new MidtransSandboxError("INVALID_CONFIGURATION", "configuration");
  return result.data;
}

const expectedSchema = z.object({
  providerOrderId: referenceSchema,
  amountIdr: amountSchema,
  providerTransactionId: z.string().min(1).max(128).optional(),
});
const createSchema = expectedSchema.omit({ providerTransactionId: true }).extend({
  paymentDueAt: z.iso.datetime({ offset: true }),
});
export type ExpectedMidtransPayment = z.infer<typeof expectedSchema>;
export type CreateSandboxQris = z.infer<typeof createSchema>;

const statusSchema = z.enum(["pending", "settlement", "expire", "deny", "cancel", "refund", "partial_refund"]);
const transactionSchema = z.object({
  status_code: z.string().regex(/^\d{3}$/),
  transaction_id: z.string().min(1).max(128),
  order_id: z.string(),
  merchant_id: z.string(),
  gross_amount: z.string(),
  currency: z.literal("IDR"),
  payment_type: z.literal("qris"),
  transaction_status: statusSchema,
  fraud_status: z.enum(["accept", "deny", "challenge"]).optional(),
  settlement_time: z.string().optional(),
  expiry_time: z.string().optional(),
  actions: z.array(z.object({ name: z.string(), method: z.string(), url: z.string() })).optional(),
});

export type SandboxTransaction = {
  providerOrderId: string;
  providerTransactionId: string;
  merchantId: string;
  amountIdr: number;
  providerStatus: z.infer<typeof statusSchema>;
  providerStatusCode: string;
  fraudStatus: "accept" | "deny" | "challenge" | null;
  providerPaidAt: string | null;
  expiresAt: string | null;
};
export type SandboxQris = SandboxTransaction & {
  qrImageUrl: string;
  expiryConfirmed: true;
};
export type SandboxStatus = { kind: "found"; transaction: SandboxTransaction } | { kind: "not_found" };

// Midtrans timestamps without an offset are documented in GMT+7. Round-trip to reject invalid dates.
function providerTime(value: string | undefined, operation: Operation): string | null {
  if (value === undefined) return null;
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) {
    throw new MidtransSandboxError("INVALID_PROVIDER_RESPONSE", operation);
  }
  const millis = Date.parse(`${value.replace(" ", "T")}+07:00`);
  if (!Number.isFinite(millis) || new Date(millis + 7 * 3_600_000).toISOString().slice(0, 19).replace("T", " ") !== value) {
    throw new MidtransSandboxError("INVALID_PROVIDER_RESPONSE", operation);
  }
  return new Date(millis).toISOString();
}

function providerAmount(value: string, operation: Operation): number {
  if (!/^(0|[1-9]\d*)(?:\.00)?$/.test(value)) {
    throw new MidtransSandboxError("INVALID_PROVIDER_RESPONSE", operation);
  }
  const amount = Number(value);
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new MidtransSandboxError("INVALID_PROVIDER_RESPONSE", operation);
  return amount;
}

type Fetcher = (url: string, init: RequestInit) => Promise<Response>;
type ClientOptions = { fetch?: Fetcher; now?: () => number; timeoutMs?: number };

/** Transport only. The caller must persist/claim the attempt before createQris; this adapter never writes orders. */
export function createMidtransSandboxClient(configuration: unknown, options: ClientOptions = {}) {
  const parsedConfig = configSchema.safeParse(configuration);
  const timeoutMs = options.timeoutMs ?? 10_000;
  if (!parsedConfig.success || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) {
    throw new MidtransSandboxError("INVALID_CONFIGURATION", "configuration");
  }
  const config = parsedConfig.data;
  const fetcher = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const authorization = `Basic ${Buffer.from(`${config.serverKey}:`).toString("base64")}`;

  async function request(path: string, operation: "create" | "status", body?: unknown): Promise<{ status: number; payload: unknown }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetcher(`${SANDBOX_URL}${path}`, {
        method: operation === "create" ? "POST" : "GET",
        headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: authorization },
        body: body === undefined ? undefined : JSON.stringify(body),
        cache: "no-store",
        redirect: "error",
        signal: controller.signal,
      });
      const text = await response.text();
      if (text.length > MAX_RESPONSE_LENGTH) throw new MidtransSandboxError("INVALID_PROVIDER_RESPONSE", operation);
      let payload: unknown;
      try {
        payload = JSON.parse(text);
      } catch {
        throw new MidtransSandboxError("INVALID_PROVIDER_RESPONSE", operation);
      }
      if (operation === "status" && response.status === 404 && z.object({ status_code: z.literal("404") }).safeParse(payload).success) {
        return { status: 404, payload };
      }
      if (!response.ok) throw new MidtransSandboxError("PROVIDER_REJECTED", operation);
      return { status: response.status, payload };
    } catch (error) {
      if (error instanceof MidtransSandboxError) throw error;
      throw new MidtransSandboxError("PROVIDER_UNAVAILABLE", operation);
    } finally {
      clearTimeout(timeout);
    }
  }

  function readTransaction(payload: unknown, expected: ExpectedMidtransPayment, operation: "create" | "status") {
    // Zod strips unknown fields: new provider fields must not break otherwise valid notifications/responses.
    const parsed = transactionSchema.safeParse(payload);
    if (!parsed.success) throw new MidtransSandboxError("INVALID_PROVIDER_RESPONSE", operation);
    const row = parsed.data;
    if (row.order_id !== expected.providerOrderId || row.merchant_id !== config.merchantId ||
        (expected.providerTransactionId !== undefined && row.transaction_id !== expected.providerTransactionId)) {
      throw new MidtransSandboxError("REFERENCE_MISMATCH", operation);
    }
    const amountIdr = providerAmount(row.gross_amount, operation);
    if (amountIdr !== expected.amountIdr) throw new MidtransSandboxError("AMOUNT_MISMATCH", operation);
    // Midtrans memberi kode 407 untuk transaksi kedaluwarsa. Pada GET Status itu fakta status, bukan penolakan permintaan.
    const expiredStatus = operation === "status" && row.status_code === "407" && row.transaction_status === "expire";
    if (!row.status_code.startsWith("2") && !expiredStatus) throw new MidtransSandboxError("PROVIDER_REJECTED", operation);
    const transaction: SandboxTransaction = {
      providerOrderId: row.order_id,
      providerTransactionId: row.transaction_id,
      merchantId: row.merchant_id,
      amountIdr,
      providerStatus: row.transaction_status,
      providerStatusCode: row.status_code,
      fraudStatus: row.fraud_status ?? null,
      providerPaidAt: providerTime(row.settlement_time, operation),
      expiresAt: providerTime(row.expiry_time, operation),
    };
    return { transaction, actions: row.actions ?? [] };
  }

  async function createQris(input: unknown): Promise<SandboxQris> {
    const parsed = createSchema.safeParse(input);
    if (!parsed.success) throw new MidtransSandboxError("INVALID_REQUEST", "create");
    const requestedAt = now();
    const start = Math.floor(requestedAt / 1_000) * 1_000;
    const due = Date.parse(parsed.data.paymentDueAt);
    const durationSeconds = Math.floor((due - start) / 1_000);
    if (!Number.isFinite(requestedAt) || due - requestedAt < 1_000 || due - requestedAt > 86_400_000) {
      throw new MidtransSandboxError("INVALID_REQUEST", "create");
    }
    const orderTime = `${new Date(start + 7 * 3_600_000).toISOString().slice(0, 19).replace("T", " ")} +0700`;
    const { payload } = await request("/v2/charge", "create", {
      payment_type: "qris",
      qris: { acquirer: config.acquirer },
      transaction_details: { order_id: parsed.data.providerOrderId, gross_amount: parsed.data.amountIdr },
      custom_expiry: { order_time: orderTime, expiry_duration: durationSeconds, unit: "second" },
    });
    const { transaction, actions } = readTransaction(payload, parsed.data, "create");
    // A returned QR is only reusable while the provider confirms a matching, still-live deadline.
    const expiry = transaction.expiresAt === null ? NaN : Date.parse(transaction.expiresAt);
    if (!Number.isFinite(expiry) || expiry > due || expiry <= now()) {
      throw new MidtransSandboxError("EXPIRY_UNCONFIRMED", "create");
    }
    if (transaction.providerStatus !== "pending" || (transaction.fraudStatus !== null && transaction.fraudStatus !== "accept")) {
      throw new MidtransSandboxError("PROVIDER_REJECTED", "create");
    }
    const action = actions.find((item) => item.name === "generate-qr-code" && item.method === "GET");
    if (!action) throw new MidtransSandboxError("INVALID_PROVIDER_RESPONSE", "create");
    let qrUrl: URL;
    try {
      qrUrl = new URL(action.url);
    } catch {
      throw new MidtransSandboxError("INVALID_PROVIDER_RESPONSE", "create");
    }
    if (qrUrl.href !== sandboxQrImageUrl(transaction.providerTransactionId) || qrUrl.username || qrUrl.password) {
      throw new MidtransSandboxError("INVALID_PROVIDER_RESPONSE", "create");
    }
    return { ...transaction, qrImageUrl: qrUrl.href, expiryConfirmed: true };
  }

  async function getStatus(input: unknown): Promise<SandboxStatus> {
    const parsed = expectedSchema.safeParse(input);
    if (!parsed.success) throw new MidtransSandboxError("INVALID_REQUEST", "status");
    const response = await request(`/v2/${encodeURIComponent(parsed.data.providerOrderId)}/status`, "status");
    // A single 404 is an observation, never permission to create a fresh attempt.
    if (response.status === 404) return { kind: "not_found" };
    return { kind: "found", transaction: readTransaction(response.payload, parsed.data, "status").transaction };
  }

  return { createQris, getStatus };
}

/** URL gambar QR Sandbox untuk satu transaksi. Dipakai juga saat rekonsiliasi, karena respons status tidak membawa URL QR. */
export function sandboxQrImageUrl(providerTransactionId: string): string {
  return new URL(`/v2/qris/${encodeURIComponent(providerTransactionId)}/qr-code`, SANDBOX_URL).href;
}

const notificationSchema = z.object({
  order_id: referenceSchema,
  status_code: z.string().regex(/^\d{3}$/),
  // Teks asli dipakai untuk signature, jadi tidak diubah ke angka di sini.
  gross_amount: z.string().regex(/^(0|[1-9]\d*)(?:\.\d{2})?$/),
  signature_key: z.string().regex(/^[a-f0-9]{128}$/i),
  transaction_id: z.string().min(1).max(128),
  transaction_status: z.string().min(1).max(40),
});
export type MidtransNotification = {
  providerOrderId: string;
  providerTransactionId: string;
  providerStatus: string;
  amountIdr: number;
};

/**
 * Notifikasi HTTP Midtrans hanya dipercaya bila `signature_key` = SHA-512(order_id + status_code + gross_amount + server key).
 * Hasil null berarti tidak sah, termasuk bentuk tidak dikenal. Isi notifikasi tetap dicek ulang lewat `getStatus` sebelum diterapkan.
 */
export function verifyMidtransNotification(configuration: MidtransSandboxConfig, payload: unknown): MidtransNotification | null {
  const parsed = notificationSchema.safeParse(payload);
  if (!parsed.success) return null;
  const row = parsed.data;
  const expected = createHash("sha512").update(`${row.order_id}${row.status_code}${row.gross_amount}${configuration.serverKey}`).digest();
  const received = Buffer.from(row.signature_key, "hex");
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) return null;
  const amountIdr = Number(row.gross_amount);
  if (!Number.isSafeInteger(amountIdr) || amountIdr <= 0) return null;
  return { providerOrderId: row.order_id, providerTransactionId: row.transaction_id, providerStatus: row.transaction_status, amountIdr };
}
