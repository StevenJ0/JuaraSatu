import { describe, expect, it } from "vitest";
import { summarizeCapacity } from "@/features/capacity/availability";

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
