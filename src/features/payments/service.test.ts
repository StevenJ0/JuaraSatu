import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { hashPrivateOrderToken } from "@/features/orders/service";
import { PaymentRepositoryError, applyVerifiedPaymentRecord, claimPaymentAttemptRecord, recordPaymentChargeRecord } from "@/features/payments/repository";
import { verifiedPaymentFactSchema } from "@/features/payments/schemas";
import { applyVerifiedPayment, claimPaymentAttempt, recordPaymentCharge } from "@/features/payments/service";

vi.mock("@/features/payments/repository", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/features/payments/repository")>();
  return { ...original, applyVerifiedPaymentRecord: vi.fn(), claimPaymentAttemptRecord: vi.fn(), recordPaymentChargeRecord: vi.fn() };
});

const claim = vi.mocked(claimPaymentAttemptRecord);
const apply = vi.mocked(applyVerifiedPaymentRecord);
const charge = vi.mocked(recordPaymentChargeRecord);

// Repository di-mock sehingga client tidak pernah dipakai.
const client = {} as SupabaseClient;
const ID = "11111111-1111-4111-8111-111111111111";
const TOKEN = "t".repeat(43);
const fact = {
  providerOrderId: "CL-ABC-1",
  providerEventKey: "txn-1:settlement",
  payloadHash: "hash",
  providerStatus: "settlement",
  providerTransactionId: "txn-1",
  amountIdr: 216000,
  providerPaidAt: "2026-11-06T05:00:00+07:00",
};

beforeEach(() => {
  vi.resetAllMocks();
});

describe("claimPaymentAttempt", () => {
  it("hanya mengirim hash token ke database", async () => {
    claim.mockResolvedValue({ paymentId: ID, providerOrderId: "CL-ABC-1", attemptNumber: 1, amountIdr: 1000, status: "initiating", qrContent: null, qrExpiresAt: null, reused: false });

    await expect(claimPaymentAttempt(client, TOKEN)).resolves.toMatchObject({ kind: "ok" });

    expect(claim).toHaveBeenCalledWith(client, hashPrivateOrderToken(TOKEN));
    expect(claim.mock.calls[0]).not.toContain(TOKEN);
  });

  it.each(["", "pendek"])("token tidak berbentuk token ditolak tanpa menyentuh database: %j", async (token) => {
    await expect(claimPaymentAttempt(client, token)).resolves.toEqual({ kind: "rejected", violation: "ORDER_NOT_FOUND" });
    expect(claim).not.toHaveBeenCalled();
  });

  it("melaporkan pesanan yang sudah tidak bisa dibayar", async () => {
    claim.mockRejectedValue(new PaymentRepositoryError("claim", "P0001", "ORDER_STATE_INVALID"));
    await expect(claimPaymentAttempt(client, TOKEN)).resolves.toEqual({ kind: "rejected", violation: "ORDER_STATE_INVALID" });
  });
});

describe("recordPaymentCharge", () => {
  it("false bukan kesalahan: percobaan sudah tidak aktif", async () => {
    charge.mockResolvedValue(false);
    await expect(recordPaymentCharge(client, { paymentId: ID, providerTransactionId: null, qrContent: "qr", qrExpiresAt: null })).resolves.toEqual({ kind: "ok", value: false });
  });
});

describe("applyVerifiedPayment", () => {
  it("meneruskan hasil penerapan", async () => {
    apply.mockResolvedValue({ outcome: "applied", paymentId: ID, orderId: ID, orderStatus: "awaiting_confirmation" });
    await expect(applyVerifiedPayment(client, fact)).resolves.toMatchObject({ kind: "ok", value: { outcome: "applied" } });
  });

  it("melaporkan referensi yang tidak dikenal", async () => {
    apply.mockRejectedValue(new PaymentRepositoryError("apply", "P0001", "PAYMENT_NOT_FOUND"));
    await expect(applyVerifiedPayment(client, fact)).resolves.toEqual({ kind: "rejected", violation: "PAYMENT_NOT_FOUND" });
  });

  it("kegagalan database tidak dianggap berhasil, supaya webhook tidak mengakui palsu", async () => {
    apply.mockRejectedValue(new PaymentRepositoryError("apply", "08006", null));
    await expect(applyVerifiedPayment(client, fact)).rejects.toBeInstanceOf(PaymentRepositoryError);
  });
});

describe("verifiedPaymentFactSchema", () => {
  it("menerima fakta yang lengkap", () => {
    expect(verifiedPaymentFactSchema.safeParse(fact).success).toBe(true);
  });

  it.each([
    ["nominal desimal", { amountIdr: 1000.5 }],
    ["nominal minus", { amountIdr: -1 }],
    ["referensi kosong", { providerOrderId: "" }],
    ["kunci event kosong", { providerEventKey: "" }],
    ["waktu tidak sah", { providerPaidAt: "kemarin" }],
  ])("menolak %s", (_name, override) => {
    expect(verifiedPaymentFactSchema.safeParse({ ...fact, ...override }).success).toBe(false);
  });
});
