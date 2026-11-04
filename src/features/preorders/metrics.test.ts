import { describe, expect, it } from "vitest";
import { summarizePreorder } from "@/features/preorders/metrics";

const now = new Date("2026-11-04T00:00:00Z");
const future = "2026-11-04T01:00:00Z";
const past = "2026-11-03T23:00:00Z";
const allocated = (quantity: number) => ({ quantity, state: "allocated" as const, expiresAt: null });
const held = (quantity: number, expiresAt = future) => ({ quantity, state: "held" as const, expiresAt });

function metricsFor({ target = 40, quota = 40, total = 40, event = [allocated(30), held(2)], otherOrders = [] as ReturnType<typeof allocated>[] }) {
  return summarizePreorder(
    { targetUnits: target, quotaUnits: quota, capacityTotalUnits: total, preorderReservations: event, capacityReservations: [...event, ...otherOrders] },
    now,
  );
}

describe("summarizePreorder", () => {
  it("acceptance R3: target 40, dibayar 30, ditahan 2 memberi selisih 10 dan bisa dipesan 8", () => {
    const metrics = metricsFor({});
    expect(metrics).toMatchObject({ paidUnits: 30, heldUnits: 2, paidTargetGap: 10, orderableUnits: 8 });
  });

  it("hold kedaluwarsa tidak mengurangi yang bisa dipesan", () => {
    expect(metricsFor({ event: [allocated(30), held(2, past)] })).toMatchObject({ heldUnits: 0, orderableUnits: 10 });
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
});
