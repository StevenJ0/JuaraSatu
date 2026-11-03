import { describe, expect, it } from "vitest";
import { summarizeCapacity, summarizeOpenCapacities } from "@/features/capacity/availability";

describe("summarizeOpenCapacities", () => {
  const now = new Date("2026-11-03T00:00:00Z");
  const capacity = (intakeCutoffAt: string, available: number) => ({
    intakeCutoffAt,
    availability: { allocated: 0, effectiveHeld: 0, available },
  });

  it("hanya menghitung jadwal yang batas pesannya belum lewat", () => {
    expect(
      summarizeOpenCapacities([capacity("2026-11-05T00:00:00Z", 10), capacity("2026-11-01T00:00:00Z", 99)], now),
    ).toEqual({ scheduleCount: 1, availableUnits: 10 });
  });

  it("menganggap batas pesan yang tepat sekarang sudah lewat", () => {
    expect(summarizeOpenCapacities([capacity("2026-11-03T00:00:00Z", 10)], now).scheduleCount).toBe(0);
  });

  it("tidak mengurangi total dengan sisa minus", () => {
    expect(
      summarizeOpenCapacities([capacity("2026-11-05T00:00:00Z", -3), capacity("2026-11-06T00:00:00Z", 5)], now),
    ).toEqual({ scheduleCount: 2, availableUnits: 5 });
  });

  it("mengembalikan nol bila belum ada jadwal", () => {
    expect(summarizeOpenCapacities([], now)).toEqual({ scheduleCount: 0, availableUnits: 0 });
  });
});

const NOW = new Date("2026-11-07T10:00:00Z");
const FUTURE = "2026-11-07T10:15:00Z";
const PAST = "2026-11-07T09:45:00Z";

describe("summarizeCapacity", () => {
  it("menghitung allocated dan hold aktif, mengabaikan hold kedaluwarsa dan released", () => {
    const summary = summarizeCapacity(
      40,
      [
        { quantity: 30, state: "allocated", expiresAt: null },
        { quantity: 2, state: "held", expiresAt: FUTURE },
        { quantity: 5, state: "held", expiresAt: PAST },
        { quantity: 3, state: "released", expiresAt: null },
      ],
      NOW,
    );
    expect(summary).toEqual({ allocated: 30, effectiveHeld: 2, available: 8 });
  });

  it("hold yang habis tepat sekarang tidak lagi aktif", () => {
    const summary = summarizeCapacity(10, [{ quantity: 4, state: "held", expiresAt: NOW.toISOString() }], NOW);
    expect(summary.available).toBe(10);
  });

  it("kapasitas tanpa reservasi tersedia penuh", () => {
    expect(summarizeCapacity(25, [], NOW)).toEqual({ allocated: 0, effectiveHeld: 0, available: 25 });
  });
});
