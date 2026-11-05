import { describe, expect, it } from "vitest";
import { toPrivateOrderStatus } from "@/features/orders/private-status";

const now = new Date("2026-11-10T05:00:00.000Z");
const facts = {
  publicOrderNumber: "CL-ABC123",
  orderStatus: "pending_payment" as const,
  fulfillmentStatus: "pending_confirmation" as const,
  paymentState: "none" as const,
  paymentVerifiedAt: null,
  paymentDueAt: "2026-11-10T05:15:00.000Z",
  businessName: "Toko Contoh",
  preorderName: "Preorder Kaos",
  productName: "Kaos",
  sku: "KAOS-1",
  quantity: 2,
  baseUnitPriceIdr: 120000,
  discountPerUnitIdr: 0,
  finalUnitPriceIdr: 120000,
  subtotalIdr: 240000,
  discountTotalIdr: 0,
  totalIdr: 240000,
  fulfillmentDate: "2026-11-20",
  fulfillmentWindowEndAt: "2026-11-20T10:00:00.000Z",
  pickup: { instructions: "Ambil di toko", publicContact: "0812" },
};

describe("toPrivateOrderStatus", () => {
  it("meneruskan status selama tenggat belum lewat", () => {
    expect(toPrivateOrderStatus(facts, now)).toMatchObject({ orderStatus: "pending_payment", asOf: now.toISOString() });
  });

  it("tenggat lewat dibaca kedaluwarsa walau statusnya belum dirapikan", () => {
    expect(toPrivateOrderStatus({ ...facts, paymentDueAt: "2026-11-10T04:59:59.000Z" }, now).orderStatus).toBe("expired");
  });

  it("tepat di tenggat sudah kedaluwarsa, sama dengan database", () => {
    expect(toPrivateOrderStatus({ ...facts, paymentDueAt: now.toISOString() }, now).orderStatus).toBe("expired");
  });

  it("status lain tidak terpengaruh tenggat yang lewat", () => {
    const paid = { ...facts, orderStatus: "awaiting_confirmation" as const, paymentDueAt: "2026-11-10T04:00:00.000Z" };
    expect(toPrivateOrderStatus(paid, now).orderStatus).toBe("awaiting_confirmation");
  });

  it("pembayaran hanya bisa dilanjutkan selama menunggu bayar dan tenggat belum lewat", () => {
    expect(toPrivateOrderStatus(facts, now).canContinuePayment).toBe(true);
    expect(toPrivateOrderStatus({ ...facts, paymentDueAt: now.toISOString() }, now).canContinuePayment).toBe(false);
    for (const orderStatus of ["awaiting_confirmation", "active", "expired", "cancelled", "requires_review"] as const) {
      expect(toPrivateOrderStatus({ ...facts, orderStatus }, now).canContinuePayment).toBe(false);
    }
  });

  it("pembayaran dan pemenuhan tetap terpisah", () => {
    const ready = { ...facts, orderStatus: "active" as const, fulfillmentStatus: "ready" as const };
    expect(toPrivateOrderStatus(ready, now)).toMatchObject({ orderStatus: "active", fulfillmentStatus: "ready" });
  });

  it("hanya memuat field yang diizinkan walau masukannya membawa data privat", () => {
    const withPrivateData = {
      ...facts,
      customerName: "Budi Rahasia",
      customerEmail: "budi@example.com",
      customerContact: "0899",
      cancelReason: "alasan internal",
      privateTokenHash: "hash-rahasia",
      variableCostPerUnitIdr: 75000,
      pickup: { ...facts.pickup, internalNote: "catatan" },
    };

    const text = JSON.stringify(toPrivateOrderStatus(withPrivateData, now));

    for (const forbidden of ["Budi", "budi@example.com", "0899", "alasan internal", "hash-rahasia", "75000", "catatan"]) {
      expect(text).not.toContain(forbidden);
    }
  });
});
