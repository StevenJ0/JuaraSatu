import { describe, expect, it } from "vitest";
import { summarizeOrders } from "@/features/orders/recap";
import type { OrderStatusFacts } from "@/features/orders/status";

const now = new Date("2026-11-04T10:00:00Z");
const order = (overrides: Partial<OrderStatusFacts>, quantity = 2) => ({
  orderStatus: "active" as const,
  fulfillmentStatus: "confirmed" as const,
  externalPaymentStatus: "confirmed" as const,
  paymentDueAt: null,
  quantity,
  ...overrides,
});

describe("summarizeOrders", () => {
  it("kosong bila belum ada pesanan", () => {
    expect(summarizeOrders([], now)).toEqual({ unitsToProduce: 0, unitsReady: 0, unitsFulfilled: 0, ordersNeedingAction: 0 });
  });

  it("menghitung tiap kelompok", () => {
    const recap = summarizeOrders(
      [
        order({}, 3),
        order({ fulfillmentStatus: "in_production" }, 4),
        order({ fulfillmentStatus: "ready" }, 5),
        order({ fulfillmentStatus: "fulfilled" }, 6),
        order({ orderStatus: "awaiting_confirmation", fulfillmentStatus: "pending_confirmation" }, 1),
      ],
      now,
    );
    expect(recap).toEqual({ unitsToProduce: 8, unitsReady: 5, unitsFulfilled: 6, ordersNeedingAction: 1 });
  });

  it("pesanan batal tidak jadi kebutuhan produksi baru (FR-ORD-05)", () => {
    const recap = summarizeOrders(
      [order({ orderStatus: "cancelled", fulfillmentStatus: "cancelled" }), order({ orderStatus: "expired", fulfillmentStatus: "cancelled" })],
      now,
    );
    expect(recap.unitsToProduce).toBe(0);
  });

  it("pesanan pembeli yang belum dibayar belum perlu dibuat", () => {
    const pending = order({ orderStatus: "pending_payment", fulfillmentStatus: "pending_confirmation", externalPaymentStatus: null, paymentDueAt: "2026-11-04T11:00:00Z" });
    expect(summarizeOrders([pending], now)).toMatchObject({ unitsToProduce: 0, ordersNeedingAction: 0 });
  });

  it("tenggat yang lewat tidak dihitung", () => {
    const overdue = order({ orderStatus: "pending_payment", fulfillmentStatus: "pending_confirmation", externalPaymentStatus: null, paymentDueAt: "2026-11-04T09:00:00Z" });
    expect(summarizeOrders([overdue], now)).toMatchObject({ unitsToProduce: 0, ordersNeedingAction: 0 });
  });

  it("pesanan manual belum lunas tetap perlu dibuat dan perlu tindakan", () => {
    const unpaid = order({ orderStatus: "awaiting_confirmation", fulfillmentStatus: "pending_confirmation", externalPaymentStatus: "unpaid" }, 7);
    expect(summarizeOrders([unpaid], now)).toMatchObject({ unitsToProduce: 7, ordersNeedingAction: 1 });
  });
});
