import { describe, expect, it } from "vitest";
import { createProductSku } from "@/features/products/sku";

describe("createProductSku", () => {
  it("menyusun SKU huruf besar dari nama dan akhiran", () => {
    expect(createProductSku("Brownies Panggang", "a1b2c3")).toBe("BROWNIES-PANGGANG-A1B2C3");
  });

  it("menghapus aksen dan simbol", () => {
    expect(createProductSku("Kué & Roti!", "a1b2c3")).toBe("KUE-ROTI-A1B2C3");
  });

  it("memakai nama cadangan bila nama tidak punya huruf latin", () => {
    expect(createProductSku("🍰🍰", "a1b2c3")).toBe("PRODUK-A1B2C3");
  });

  it("tetap di dalam batas kolom untuk nama sepanjang batas maksimal", () => {
    const sku = createProductSku("a".repeat(160));
    expect(sku.length).toBeLessThanOrEqual(80);
    expect(sku).toMatch(/^A+-[A-Z0-9]{6}$/);
  });

  it("menghasilkan SKU berbeda untuk nama yang sama", () => {
    expect(createProductSku("Brownies")).not.toBe(createProductSku("Brownies"));
  });
});
