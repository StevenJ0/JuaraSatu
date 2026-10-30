import { describe, expect, it } from "vitest";
import { createBusinessSlug, randomSlugSuffix, slugify } from "@/features/business/slug";

describe("slugify", () => {
  it("membuat slug lowercase URL-safe", () => {
    expect(slugify("  Brownies Homemade Bu Sri!! ", 100)).toBe("brownies-homemade-bu-sri");
  });

  it("menghapus diakritik dan karakter non-latin", () => {
    expect(slugify("Crème Brûlée & Kue", 100)).toBe("creme-brulee-kue");
  });

  it("memakai fallback bila hasilnya kosong", () => {
    expect(slugify("🍰🍰", 100)).toBe("usaha");
  });

  it("memotong tanpa menyisakan tanda hubung di akhir", () => {
    expect(slugify("abc def", 4)).toBe("abc");
  });
});

describe("createBusinessSlug", () => {
  it("menambahkan akhiran", () => {
    expect(createBusinessSlug("Brownies Sabtu", "x1y2z3")).toBe("brownies-sabtu-x1y2z3");
  });

  it("tidak melebihi 140 karakter (schema businesses.slug)", () => {
    const slug = createBusinessSlug("a".repeat(500));
    expect(slug.length).toBeLessThanOrEqual(140);
    expect(slug).toMatch(/^[a-z0-9-]+$/);
  });

  it("akhiran acak 6 karakter alfanumerik lowercase", () => {
    expect(randomSlugSuffix()).toMatch(/^[a-z0-9]{6}$/);
  });
});
