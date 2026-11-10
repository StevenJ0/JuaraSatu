import { describe, expect, it } from "vitest";
import { SLIDER_LEAD, SLIDER_TAIL, dragOffset, sliderPosition, sliderProgressFor, swipeDirection } from "@/features/marketing/feature-slider";

describe("geser kartu fitur di HP", () => {
  it("diam di kartu pertama selama jeda awal dan di kartu terakhir selama jeda akhir", () => {
    expect(sliderPosition(0, 6)).toBe(0);
    expect(sliderPosition(SLIDER_LEAD, 6)).toBe(0);
    expect(sliderPosition(1 - SLIDER_TAIL, 6)).toBe(5);
    expect(sliderPosition(1, 6)).toBe(5);
  });

  it("menahan kartu sebentar sebelum bergeser, lalu bergerak naik terus", () => {
    const at = (index: number, fraction: number) => sliderPosition(sliderProgressFor(index, 6) + (fraction / 5) * (1 - SLIDER_LEAD - SLIDER_TAIL), 6);
    expect(at(2, 0.1)).toBe(2);
    expect(at(2, 0.5)).toBeCloseTo(2.5, 6);
    expect(at(2, 0.9)).toBe(3);
    let previous = -1;
    for (let progress = 0; progress <= 1; progress += 0.01) {
      const position = sliderPosition(progress, 6);
      expect(position).toBeGreaterThanOrEqual(previous);
      previous = position;
    }
  });

  it("titik tab menampilkan kartu itu tepat di tempatnya", () => {
    for (let index = 0; index < 6; index++) expect(sliderPosition(sliderProgressFor(index, 6), 6)).toBe(index);
  });

  it("satu kartu tidak pernah bergeser", () => {
    expect(sliderPosition(0.7, 1)).toBe(0);
    expect(sliderProgressFor(3, 1)).toBe(0);
  });
});

describe("geser kartu fitur dengan jari", () => {
  it("geser mendatar yang cukup jauh memindah kartu", () => {
    expect(swipeDirection(-80, 10)).toBe(1);
    expect(swipeDirection(80, -10)).toBe(-1);
  });

  it("ketukan, geseran pendek, dan gulir tegak tidak memindah kartu", () => {
    expect(swipeDirection(0, 0)).toBe(0);
    expect(swipeDirection(-20, 0)).toBe(0);
    expect(swipeDirection(-60, 120)).toBe(0);
  });

  it("kartu mengikuti jari, tertahan di ujung, dan dibatasi", () => {
    expect(dragOffset(-100, 2, 6)).toBe(-50);
    expect(dragOffset(100, 0, 6)).toBe(15);
    expect(dragOffset(-100, 5, 6)).toBe(-15);
    expect(dragOffset(-1000, 2, 6)).toBe(-120);
  });
});
