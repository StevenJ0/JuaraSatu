import { describe, expect, it } from "vitest";
import { sanitizeUnitsInput } from "@/lib/units-input";

describe("sanitizeUnitsInput", () => {
  it.each([
    ["10aaaaaaa", "10"],
    ["abc", ""],
    ["1.5", "15"],
    ["-5", "5"],
    ["1e3", "13"],
    ["1 000", "1000"],
    ["٣", ""],
    ["007", "7"],
    ["0", "0"],
    ["00", "0"],
    ["", ""],
    ["1234567", "12345"],
  ])("%j menjadi %j", (raw, expected) => {
    expect(sanitizeUnitsInput(raw)).toBe(expected);
  });
});
