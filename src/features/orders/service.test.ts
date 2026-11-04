import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { OrderRepositoryError, createManualOrderRecord, createPublicOrderRecord, advanceOrder, closeOrder } from "@/features/orders/repository";
import {
  cancelOrder,
  createManualOrder,
  createPrivateOrderToken,
  expireOrder,
  hashOrderRequest,
  hashPrivateOrderToken,
  placePublicOrder,
  resolveHoldTtlSeconds,
  runOrderAction,
} from "@/features/orders/service";

vi.mock("@/features/orders/repository", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/features/orders/repository")>();
  return { ...original, createManualOrderRecord: vi.fn(), createPublicOrderRecord: vi.fn(), advanceOrder: vi.fn(), closeOrder: vi.fn() };
});

const createManual = vi.mocked(createManualOrderRecord);
const createPublic = vi.mocked(createPublicOrderRecord);
const advance = vi.mocked(advanceOrder);
const close = vi.mocked(closeOrder);

// Repository di-mock sehingga client tidak pernah dipakai.
const client = {} as SupabaseClient;
const ORDER_ID = "11111111-1111-4111-8111-111111111111";
const result = { orderId: ORDER_ID, publicOrderNumber: "CL-ABC", orderStatus: "pending_payment", totalIdr: 1000, paymentDueAt: null, replayed: false };
const rejected = (violation: "CAPACITY_UNAVAILABLE" | "VERSION_CONFLICT") => new OrderRepositoryError("op", "P0001", violation);

const buyer = {
  slug: "kaos-abc123",
  idempotencyKey: "kunci-yang-cukup-panjang",
  privateToken: "token-rahasia-pembeli-yang-panjang",
  customerName: "Budi",
  customerEmail: "budi@example.com",
  customerContact: null,
  quantity: 2,
  expectedUnitPriceIdr: 120000,
};
const manual = {
  preorderId: ORDER_ID,
  idempotencyKey: "22222222-2222-4222-8222-222222222222",
  customerName: "Budi",
  customerEmail: null,
  customerContact: null,
  quantity: 1,
  paymentStatus: "paid" as const,
};

beforeEach(() => {
  vi.resetAllMocks();
});

describe("resolveHoldTtlSeconds", () => {
  it("memakai 15 menit bila belum diatur", () => {
    expect(resolveHoldTtlSeconds(undefined)).toBe(900);
    expect(resolveHoldTtlSeconds("")).toBe(900);
  });

  it("memakai nilai environment yang sah", () => {
    expect(resolveHoldTtlSeconds("600")).toBe(600);
  });

  it.each(["abc", "0", "-5", "1.5", "999999"])("mengabaikan nilai tidak sah %j", (raw) => {
    expect(resolveHoldTtlSeconds(raw)).toBe(900);
  });
});

describe("token dan hash", () => {
  it("token acak dan cukup panjang", () => {
    const token = createPrivateOrderToken();
    expect(token.length).toBeGreaterThanOrEqual(43);
    expect(createPrivateOrderToken()).not.toBe(token);
  });

  it("hash token tidak memuat token mentah", () => {
    const hash = hashPrivateOrderToken("rahasia");
    expect(hash).toHaveLength(64);
    expect(hash).not.toContain("rahasia");
  });

  it("hash permintaan tidak bergantung urutan kolom tapi peka isi", () => {
    expect(hashOrderRequest({ a: 1, b: "x" })).toBe(hashOrderRequest({ b: "x", a: 1 }));
    expect(hashOrderRequest({ a: 1, b: "x" })).not.toBe(hashOrderRequest({ a: 2, b: "x" }));
  });
});

describe("placePublicOrder", () => {
  it("mengirim hash token, bukan token mentah", async () => {
    createPublic.mockResolvedValue(result);
    await expect(placePublicOrder(client, buyer, 900)).resolves.toEqual({ kind: "ok", value: result });
    const record = createPublic.mock.calls[0]?.[1];
    expect(record?.tokenHash).toBe(hashPrivateOrderToken(buyer.privateToken));
    expect(JSON.stringify(record)).not.toContain(buyer.privateToken);
    expect(record?.holdTtlSeconds).toBe(900);
  });

  it("isi sama memberi hash permintaan sama, isi beda memberi hash beda", async () => {
    createPublic.mockResolvedValue(result);
    await placePublicOrder(client, buyer, 900);
    await placePublicOrder(client, buyer, 900);
    await placePublicOrder(client, { ...buyer, quantity: 3 }, 900);
    const [first, second, third] = createPublic.mock.calls.map((call) => call[1].requestHash);
    expect(first).toBe(second);
    expect(third).not.toBe(first);
  });

  it("melaporkan pelanggaran aturan", async () => {
    createPublic.mockRejectedValue(rejected("CAPACITY_UNAVAILABLE"));
    await expect(placePublicOrder(client, buyer, 900)).resolves.toEqual({ kind: "rejected", violation: "CAPACITY_UNAVAILABLE" });
  });

  it("meneruskan error tak terduga", async () => {
    createPublic.mockRejectedValue(new OrderRepositoryError("op", "08006", null));
    await expect(placePublicOrder(client, buyer, 900)).rejects.toThrow(/08006/);
  });
});

describe("aksi pemilik", () => {
  it("pesanan manual melewati hash yang stabil", async () => {
    createManual.mockResolvedValue(result);
    await createManualOrder(client, manual);
    await createManualOrder(client, manual);
    expect(createManual.mock.calls[0]?.[2]).toBe(createManual.mock.calls[1]?.[2]);
  });

  it("melaporkan konflik versi", async () => {
    advance.mockRejectedValue(rejected("VERSION_CONFLICT"));
    await expect(runOrderAction(client, ORDER_ID, 1, "confirm")).resolves.toEqual({ kind: "rejected", violation: "VERSION_CONFLICT" });
  });

  it("membatalkan dengan alasan", async () => {
    await expect(cancelOrder(client, ORDER_ID, 2, "Pembeli batal")).resolves.toMatchObject({ kind: "ok" });
    expect(close).toHaveBeenCalledWith(client, ORDER_ID, 2, "cancel", "Pembeli batal");
  });

  it("melepas slot kedaluwarsa tanpa alasan", async () => {
    await expireOrder(client, ORDER_ID, null);
    expect(close).toHaveBeenCalledWith(client, ORDER_ID, null, "expire", null);
  });
});
