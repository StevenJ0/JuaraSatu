import { describe, expect, it } from "vitest";
import {
  cancelWillReleaseSlot,
  canCancelOrder,
  matchesOrderFilter,
  nextOrderStep,
  orderBadge,
  paymentBadge,
  toOrderFilter,
  type OrderStatusFacts,
} from "@/features/orders/status";

const now = new Date("2026-11-04T10:00:00Z");
const base: OrderStatusFacts = { orderStatus: "awaiting_confirmation", fulfillmentStatus: "pending_confirmation", externalPaymentStatus: "confirmed", paymentDueAt: null };
const publicPending: OrderStatusFacts = { orderStatus: "pending_payment", fulfillmentStatus: "pending_confirmation", externalPaymentStatus: null, paymentDueAt: "2026-11-04T10:15:00Z" };
const overdue: OrderStatusFacts = { ...publicPending, paymentDueAt: "2026-11-04T09:00:00Z" };
const active = (fulfillmentStatus: OrderStatusFacts["fulfillmentStatus"]): OrderStatusFacts => ({ ...base, orderStatus: "active", fulfillmentStatus });

describe("orderBadge", () => {
  it.each([
    [base, "Perlu dikonfirmasi"],
    [active("confirmed"), "Dikonfirmasi"],
    [active("in_production"), "Diproduksi"],
    [active("ready"), "Siap diambil"],
    [active("fulfilled"), "Selesai"],
    [publicPending, "Menunggu pembayaran"],
    [overdue, "Kedaluwarsa"],
    [{ ...base, orderStatus: "expired" as const }, "Kedaluwarsa"],
    [{ ...base, orderStatus: "cancelled" as const }, "Dibatalkan"],
    [{ ...base, orderStatus: "requires_review" as const }, "Perlu ditinjau"],
  ])("%j menjadi %s", (order, label) => {
    expect(orderBadge(order, now).label).toBe(label);
  });
});

describe("paymentBadge", () => {
  it("membedakan manual dari sandbox", () => {
    expect(paymentBadge(base, now).label).toBe("Lunas (manual)");
    expect(paymentBadge({ ...base, externalPaymentStatus: null }, now).label).toBe("Lunas (sandbox)");
  });

  it("manual belum dibayar", () => {
    expect(paymentBadge({ ...base, externalPaymentStatus: "unpaid" }, now)).toEqual({ label: "Menunggu bayar", tone: "warning" });
  });

  it("pesanan batal yang belum dibayar tidak menampilkan kata Dibatalkan dua kali", () => {
    const cancelled = { ...base, orderStatus: "cancelled" as const, fulfillmentStatus: "cancelled" as const };
    expect(paymentBadge({ ...cancelled, externalPaymentStatus: "voided" }, now).label).toBe("Tidak ditagih");
    expect(paymentBadge({ ...cancelled, externalPaymentStatus: null }, now).label).toBe("Tidak ditagih");
  });

  it("pesanan pembeli yang belum dibayar tidak pernah terbaca lunas", () => {
    expect(paymentBadge(publicPending, now).label).toBe("Menunggu bayar");
    expect(paymentBadge(overdue, now).label).toBe("Kedaluwarsa");
  });
});

describe("nextOrderStep", () => {
  it.each([
    [{ ...base, externalPaymentStatus: "unpaid" as const }, "mark_paid"],
    [base, "confirm"],
    [active("confirmed"), "start_production"],
    [active("in_production"), "mark_ready"],
    [active("ready"), "fulfill"],
  ])("%j lanjut ke %s", (order, action) => {
    expect(nextOrderStep(order)?.action).toBe(action);
  });

  it.each([
    [publicPending],
    [active("fulfilled")],
    [{ ...base, orderStatus: "cancelled" as const, fulfillmentStatus: "cancelled" as const }],
    [{ ...base, orderStatus: "expired" as const, fulfillmentStatus: "cancelled" as const }],
    [{ ...base, orderStatus: "requires_review" as const }],
  ])("%j tidak punya langkah", (order) => {
    expect(nextOrderStep(order)).toBeNull();
  });
});

describe("pembatalan", () => {
  it("pesanan selesai tidak bisa dibatalkan", () => {
    expect(canCancelOrder(active("fulfilled"))).toBe(false);
    expect(canCancelOrder(active("ready"))).toBe(true);
  });

  it("slot hanya kembali bila produksi belum mulai", () => {
    expect(cancelWillReleaseSlot(base)).toBe(true);
    expect(cancelWillReleaseSlot(active("confirmed"))).toBe(true);
    expect(cancelWillReleaseSlot(active("in_production"))).toBe(false);
    expect(cancelWillReleaseSlot(active("ready"))).toBe(false);
  });
});

describe("filter pesanan", () => {
  const unpaid: OrderStatusFacts = { ...base, externalPaymentStatus: "unpaid" };

  it("nilai asing menjadi semua", () => {
    expect(toOrderFilter("hapus")).toBe("all");
    expect(toOrderFilter(["done"])).toBe("all");
    expect(toOrderFilter("done")).toBe("done");
  });

  it("memasukkan pesanan ke kelompok yang tepat", () => {
    expect(matchesOrderFilter(base, "attention", now)).toBe(true);
    expect(matchesOrderFilter(unpaid, "attention", now)).toBe(true);
    expect(matchesOrderFilter(active("confirmed"), "running", now)).toBe(true);
    expect(matchesOrderFilter(publicPending, "running", now)).toBe(true);
    expect(matchesOrderFilter(active("fulfilled"), "done", now)).toBe(true);
    expect(matchesOrderFilter(overdue, "closed", now)).toBe(true);
    expect(matchesOrderFilter(overdue, "running", now)).toBe(false);
    expect(matchesOrderFilter(active("fulfilled"), "running", now)).toBe(false);
  });
});
