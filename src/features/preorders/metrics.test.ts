import { describe, expect, it } from "vitest";
import { summarizePreorder, type PreorderReservationFact } from "@/features/preorders/metrics";

const now = new Date("2026-11-04T00:00:00Z");
const future = "2026-11-04T01:00:00Z";
const past = "2026-11-03T23:00:00Z";
const allocated = (quantity: number, payment: PreorderReservationFact["payment"] = "paid"): PreorderReservationFact => ({
  quantity,
  state: "allocated",
  expiresAt: null,
  payment,
});
const held = (quantity: number, expiresAt = future): PreorderReservationFact => ({ quantity, state: "held", expiresAt, payment: "awaiting" });

function metricsFor({ target = 40, quota = 40, total = 40, event = [allocated(30), held(2)], otherOrders = [] as PreorderReservationFact[] }) {
  return summarizePreorder(
    { targetUnits: target, quotaUnits: quota, capacityTotalUnits: total, preorderReservations: event, capacityReservations: [...event, ...otherOrders] },
    now,
  );
}

describe("summarizePreorder", () => {
  it("acceptance R3: target 40, dibayar 30, ditahan 2 memberi selisih 10 dan bisa dipesan 8", () => {
    expect(metricsFor({})).toMatchObject({ paidUnits: 30, awaitingPaymentUnits: 2, paidTargetGap: 10, orderableUnits: 8 });
  });

  it("hold kedaluwarsa tidak mengurangi yang bisa dipesan", () => {
    expect(metricsFor({ event: [allocated(30), held(2, past)] })).toMatchObject({ awaitingPaymentUnits: 0, orderableUnits: 10 });
  });

  it("dibatasi kapasitas bila pesanan lain memakai kapasitas yang sama", () => {
    expect(metricsFor({ otherOrders: [allocated(5)] }).orderableUnits).toBe(3);
  });

  it("dibatasi kuota walau kapasitas masih longgar", () => {
    expect(metricsFor({ total: 100 }).orderableUnits).toBe(8);
  });

  it("selisih target tidak pernah minus saat target terlampaui", () => {
    expect(metricsFor({ target: 20, event: [allocated(30)] }).paidTargetGap).toBe(0);
  });

  it("yang bisa dipesan tidak pernah minus", () => {
    expect(metricsFor({ total: 10 }).orderableUnits).toBe(0);
  });

  it("manual belum lunas memakai slot tapi belum dihitung dibayar", () => {
    expect(metricsFor({ event: [allocated(30), allocated(5, "awaiting")] })).toMatchObject({
      paidUnits: 30,
      awaitingPaymentUnits: 5,
      paidTargetGap: 10,
      orderableUnits: 5,
    });
  });

  it("batal setelah produksi tetap memakai slot tapi bukan penjualan", () => {
    expect(metricsFor({ event: [allocated(30), allocated(4, "void")] })).toMatchObject({
      paidUnits: 30,
      awaitingPaymentUnits: 0,
      paidTargetGap: 10,
      orderableUnits: 6,
    });
  });
});
