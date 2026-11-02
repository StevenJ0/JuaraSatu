import { describe, expect, it } from "vitest";
import { formatIdrInput } from "@/lib/format-idr";

describe("formatIdrInput", () => {
  it.each([
    ["10000", "Rp10.000"],
    ["Rp10.000", "Rp10.000"],
    ["Rp10.0005", "Rp100.005"],
    ["Rp1.000", "Rp1.000"],
    ["0", "Rp0"],
    ["007", "Rp7"],
    ["", ""],
    ["Rp", ""],
    ["abc", ""],
  ])("%j menjadi %j", (raw, expected) => {
    expect(formatIdrInput(raw)).toBe(expected);
  });

  it("membatasi jumlah digit", () => {
    expect(formatIdrInput("123456789012")).toBe("Rp1.234.567.890");
  });
});
