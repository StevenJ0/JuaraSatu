import { describe, expect, it } from "vitest";
import { productRefSchema, productSchema } from "@/features/products/schemas";

const valid = {
  name: " Brownies Panggang ",
  description: "",
  basePrice: "25000",
  costQuality: "estimated",
  variableCost: "12000",
};

function errorPaths(input: Record<string, string>) {
  const result = productSchema.safeParse(input);
  return result.success ? [] : result.error.issues.map((issue) => issue.path[0]);
}

describe("productSchema", () => {
  it("merapikan teks dan harga menjadi angka", () => {
    expect(productSchema.parse(valid)).toEqual({
      name: "Brownies Panggang",
      description: null,
      costQuality: "estimated",
      basePriceIdr: 25000,
      variableCostIdr: 12000,
    });
  });

  it.each([
    ["1.250.000", 1250000],
    ["Rp10.000", 10000],
    ["rp 10.000", 10000],
    ["Rp10000", 10000],
  ])("menerima format harga %j", (basePrice, expected) => {
    expect(productSchema.parse({ ...valid, basePrice }).basePriceIdr).toBe(expected);
  });

  it("menerima biaya Rp0 dari format tampilan", () => {
    expect(productSchema.parse({ ...valid, variableCost: "Rp0" }).variableCostIdr).toBe(0);
  });

  it.each(["25.5", "25,000", "1.25", "abc", "-5", "", "0", "Rp0", "Rp", "Rp-5", "1000000001"])("menolak harga %j", (basePrice) => {
    expect(errorPaths({ ...valid, basePrice })).toContain("basePrice");
  });

  it("biaya belum diketahui disimpan NULL, bukan 0", () => {
    const parsed = productSchema.parse({ ...valid, costQuality: "unknown", variableCost: "" });
    expect(parsed.variableCostIdr).toBeNull();
  });

  it("menolak biaya terisi saat status belum diketahui", () => {
    expect(errorPaths({ ...valid, costQuality: "unknown", variableCost: "0" })).toEqual(["variableCost"]);
  });

  it("biaya Rp0 sah bila statusnya diketahui", () => {
    expect(productSchema.parse({ ...valid, costQuality: "verified", variableCost: "0" }).variableCostIdr).toBe(0);
  });

  it("menolak biaya kosong saat status diketahui", () => {
    expect(errorPaths({ ...valid, costQuality: "verified", variableCost: "" })).toEqual(["variableCost"]);
  });

  it("menolak status biaya di luar kontrak", () => {
    expect(errorPaths({ ...valid, costQuality: "guess" })).toEqual(["costQuality"]);
  });

  it("mengabaikan SKU kiriman browser", () => {
    expect(productSchema.parse({ ...valid, sku: "SISIPAN" })).not.toHaveProperty("sku");
  });
});

describe("productRefSchema", () => {
  it("menolak id bukan uuid dan versi tidak sah", () => {
    expect(productRefSchema.safeParse({ productId: "abc", version: "1" }).success).toBe(false);
    expect(
      productRefSchema.safeParse({ productId: "11111111-1111-4111-8111-111111111111", version: "0" }).success,
    ).toBe(false);
  });
});
