import { describe, expect, it } from "vitest";
import { z } from "zod";
import { resolveProductionCostSchema } from "@/features/orders/schemas";

const valid = { orderId: "11111111-1111-4111-8111-111111111111", version: "3", costPerUnit: "75.000", quality: "verified", note: "Nota bahan" };

describe("resolveProductionCostSchema", () => {
  it("membaca rupiah berformat dan nol", () => {
    expect(resolveProductionCostSchema.parse(valid)).toMatchObject({ costPerUnitIdr: 75000, quality: "verified", note: "Nota bahan", version: 3 });
    expect(resolveProductionCostSchema.parse({ ...valid, costPerUnit: "0" }).costPerUnitIdr).toBe(0);
    expect(resolveProductionCostSchema.parse({ ...valid, costPerUnit: "Rp12.500" }).costPerUnitIdr).toBe(12500);
  });

  it("form kosong memberi galat di ketiga kolom sekaligus", () => {
    const result = resolveProductionCostSchema.safeParse({ ...valid, costPerUnit: "", quality: "", note: "" });
    expect(result.success).toBe(false);
    if (!result.success) expect(Object.keys(z.flattenError(result.error).fieldErrors).sort()).toEqual(["costPerUnit", "note", "quality"]);
  });

  it.each(["abc", "12,5", "1.5", "-1", "1000000001"])("menolak biaya %j", (costPerUnit) => {
    expect(resolveProductionCostSchema.safeParse({ ...valid, costPerUnit }).success).toBe(false);
  });

  it("biaya belum diketahui tidak bisa dipilih lagi", () => {
    expect(resolveProductionCostSchema.safeParse({ ...valid, quality: "unknown" }).success).toBe(false);
  });
});
