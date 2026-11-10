import { describe, expect, it } from "vitest";
import { summarizeRunningPreorders } from "@/features/preorders/running";

const now = new Date("2026-11-10T12:00:00Z");
const base = {
  id: "a",
  name: "Batch A",
  productName: "Brownies",
  status: "published" as const,
  targetUnits: 40,
  startsAt: "2026-11-06T12:00:00Z",
  endsAt: "2026-11-14T12:00:00Z",
  intakeCutoffAt: "2026-11-20T12:00:00Z",
  metrics: { paidUnits: 20, orderableUnits: 15 },
};

describe("summarizeRunningPreorders", () => {
  it("hanya memuat preorder yang terbit", () => {
    const rows = summarizeRunningPreorders([base, { ...base, id: "b", status: "draft" }, { ...base, id: "c", status: "closed" }], now);
    expect(rows.map((row) => row.id)).toEqual(["a"]);
  });

  it("laju cukup tidak ditawari strategi", () => {
    // 20 unit dalam 4 hari = 5/hari; sisa 20 unit dalam 4 hari butuh 5/hari.
    expect(summarizeRunningPreorders([base], now)[0]).toMatchObject({ phase: "open", pace: "on_track", needsStrategy: false, targetPercent: 50 });
  });

  it("laju jauh di bawah kebutuhan ditawari strategi dan diurutkan lebih dulu", () => {
    const slow = { ...base, id: "slow", endsAt: "2026-11-30T12:00:00Z", metrics: { paidUnits: 1, orderableUnits: 30 } };
    const rows = summarizeRunningPreorders([base, { ...slow, endsAt: "2026-11-11T12:00:00Z" }], now);
    expect(rows[0]).toMatchObject({ id: "slow", pace: "far_behind", needsStrategy: true });
  });

  it("memakai batas pesan jadwal bila lebih awal dari waktu tutup", () => {
    const row = summarizeRunningPreorders([{ ...base, intakeCutoffAt: "2026-11-12T12:00:00Z" }], now)[0];
    expect(row?.endsAt).toBe("2026-11-12T12:00:00Z");
  });

  it("belum dibuka tidak dinilai lajunya", () => {
    const row = summarizeRunningPreorders([{ ...base, startsAt: "2026-11-11T00:00:00Z", metrics: { paidUnits: 0, orderableUnits: 40 } }], now)[0];
    expect(row).toMatchObject({ phase: "not_started", pace: null, needsStrategy: false });
  });

  it("lewat waktu tutup tidak ditawari strategi walau kurang dari target", () => {
    const row = summarizeRunningPreorders([{ ...base, endsAt: "2026-11-09T12:00:00Z", metrics: { paidUnits: 2, orderableUnits: 0 } }], now)[0];
    expect(row).toMatchObject({ phase: "past_end", needsStrategy: false });
  });

  it("target tercapai dibatasi 100 persen", () => {
    const row = summarizeRunningPreorders([{ ...base, metrics: { paidUnits: 50, orderableUnits: 0 } }], now)[0];
    expect(row).toMatchObject({ pace: "target_met", targetPercent: 100 });
  });
});
