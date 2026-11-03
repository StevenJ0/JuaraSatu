import { describe, expect, it } from "vitest";
import { businessProfileSchema } from "@/features/business/schemas";

const validInput = {
  name: "  Brownies Homemade  ",
  categories: [" Fashion ", "Katering"],
  description: "",
  publicContact: " WA 0812 ",
  pickupInstructions: "  Ambil di toko, Sabtu 10.00-15.00 ",
};

describe("businessProfileSchema", () => {
  it("men-trim teks dan mengubah field opsional kosong menjadi null", () => {
    expect(businessProfileSchema.parse(validInput)).toEqual({
      name: "Brownies Homemade",
      categories: ["Fashion", "Katering"],
      description: null,
      publicContact: "WA 0812",
      pickupInstructions: "Ambil di toko, Sabtu 10.00-15.00",
    });
  });

  it("menolak nama, kategori, dan petunjuk pengambilan kosong", () => {
    const result = businessProfileSchema.safeParse({
      ...validInput,
      name: "   ",
      categories: [],
      pickupInstructions: "  ",
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path[0])).toEqual(["name", "categories", "pickupInstructions"]);
  });

  it("menerima sampai 3 kategori dan menolak yang ke-4", () => {
    const three = ["Fashion", "Katering", "Kerajinan"];
    expect(businessProfileSchema.safeParse({ ...validInput, categories: three }).success).toBe(true);
    const result = businessProfileSchema.safeParse({ ...validInput, categories: [...three, "Merchandise"] });
    expect(result.error?.issues[0]?.message).toBe("Pilih maksimal 3 kategori");
  });

  it("menolak kategori yang sama walau beda huruf besar atau spasi", () => {
    const result = businessProfileSchema.safeParse({ ...validInput, categories: ["Fashion", " fashion "] });
    expect(result.error?.issues[0]?.message).toBe("Kategori tidak boleh sama");
  });

  it("menolak kategori kosong dan yang terlalu panjang", () => {
    expect(businessProfileSchema.safeParse({ ...validInput, categories: ["  "] }).error?.issues[0]?.message).toBe("Tulis kategori lainnya");
    expect(businessProfileSchema.safeParse({ ...validInput, categories: ["a".repeat(81)] }).success).toBe(false);
  });

  it("menolak nama lebih dari 120 karakter", () => {
    expect(businessProfileSchema.safeParse({ ...validInput, name: "a".repeat(121) }).success).toBe(false);
  });

  it("mengabaikan field di luar kontrak (mis. rekening, role, business_id)", () => {
    const parsed = businessProfileSchema.parse({ ...validInput, bankAccount: "123", role: "admin" });
    expect(parsed).not.toHaveProperty("bankAccount");
    expect(parsed).not.toHaveProperty("role");
  });
});
