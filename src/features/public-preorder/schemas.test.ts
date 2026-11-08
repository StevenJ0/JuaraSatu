import { describe, expect, it } from "vitest";
import { checkoutFormSchema } from "@/features/public-preorder/schemas";

const valid = {
  slug: "preorder-kaos-abc123",
  idempotencyKey: "4b1f8f2e-3c1d-4a8e-9a55-0d6b3f1c2e7a",
  privateToken: "A".repeat(43),
  customerName: " Budi ",
  customerEmail: " Budi@Example.COM ",
  customerContact: "",
  quantity: "2",
  expectedUnitPriceIdr: "108000",
  attributionRef: "",
};

describe("checkoutFormSchema", () => {
  it("mengubah isian teks ke bentuk C4: angka, email kecil, kontak dan ref kosong menjadi null", () => {
    expect(checkoutFormSchema.parse(valid)).toEqual({
      ...valid,
      customerName: "Budi",
      customerEmail: "budi@example.com",
      customerContact: null,
      quantity: 2,
      expectedUnitPriceIdr: 108000,
      attributionRef: null,
    });
  });

  it.each([
    ["jumlah nol", { quantity: "0" }, "quantity"],
    ["jumlah pecahan", { quantity: "1.5" }, "quantity"],
    ["jumlah di atas batas", { quantity: "10001" }, "quantity"],
    ["email kosong", { customerEmail: "" }, "customerEmail"],
    ["nama kosong", { customerName: "   " }, "customerName"],
    ["harga bukan angka", { expectedUnitPriceIdr: "108rb" }, "expectedUnitPriceIdr"],
    ["harga di atas batas keuangan", { expectedUnitPriceIdr: "1000000001" }, "expectedUnitPriceIdr"],
    ["token terlalu pendek", { privateToken: "pendek" }, "privateToken"],
  ])("menolak %s", (_label, changes, field) => {
    const result = checkoutFormSchema.safeParse({ ...valid, ...changes });
    expect(result.success).toBe(false);
    expect(result.error?.issues.some((issue) => issue.path[0] === field)).toBe(true);
  });

  it("ref kampanye disimpan apa adanya, keabsahannya diperiksa database", () => {
    expect(checkoutFormSchema.parse({ ...valid, attributionRef: "promo-november" }).attributionRef).toBe("promo-november");
  });
});
