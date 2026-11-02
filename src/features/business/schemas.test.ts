import { describe, expect, it } from "vitest";
import { businessProfileSchema } from "@/features/business/schemas";

const validInput = {
  name: "  Brownies Homemade  ",
  category: "bakery",
  description: "",
  publicContact: " WA 0812 ",
  pickupInstructions: "  Ambil di toko, Sabtu 10.00-15.00 ",
};

describe("businessProfileSchema", () => {
  it("men-trim teks dan mengubah field opsional kosong menjadi null", () => {
    expect(businessProfileSchema.parse(validInput)).toEqual({
      name: "Brownies Homemade",
      category: "bakery",
      description: null,
      publicContact: "WA 0812",
      pickupInstructions: "Ambil di toko, Sabtu 10.00-15.00",
    });
  });

  it("menolak nama, kategori, dan petunjuk pengambilan kosong", () => {
    const result = businessProfileSchema.safeParse({
      ...validInput,
      name: "   ",
      category: "",
      pickupInstructions: "  ",
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path[0])).toEqual(["name", "category", "pickupInstructions"]);
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
