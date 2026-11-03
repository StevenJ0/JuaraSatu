import { describe, expect, it } from "vitest";
import { BUSINESS_CATEGORIES, readCategoriesFromForm, toCategorySelection } from "@/features/business/categories";

describe("BUSINESS_CATEGORIES", () => {
  it("muat di batas panjang kategori dan tidak ada yang ganda", () => {
    expect(BUSINESS_CATEGORIES.every((category) => category.length <= 80)).toBe(true);
    expect(new Set(BUSINESS_CATEGORIES).size).toBe(BUSINESS_CATEGORIES.length);
  });

  it("tetap memuat kategori yang sudah pernah ditawarkan", () => {
    for (const category of ["Makanan & minuman", "Fashion", "Kerajinan", "Kecantikan", "Merchandise", "Rumah tangga"]) {
      expect(BUSINESS_CATEGORIES).toContain(category);
    }
  });
});

describe("toCategorySelection", () => {
  it("mengosongkan pilihan bila belum ada kategori", () => {
    expect(toCategorySelection([])).toEqual({ selected: [], customCategory: "" });
  });

  it("memilih kategori di daftar tanpa membedakan huruf besar", () => {
    expect(toCategorySelection([" fashion ", "KATERING"])).toEqual({ selected: ["Fashion", "Katering"], customCategory: "" });
  });

  it("memisahkan kategori tulisan sendiri", () => {
    expect(toCategorySelection(["Fashion", "Jasa jahit"])).toEqual({ selected: ["Fashion"], customCategory: "Jasa jahit" });
  });
});

describe("readCategoriesFromForm", () => {
  function form(entries: [string, string][]): FormData {
    const formData = new FormData();
    for (const [key, value] of entries) formData.append(key, value);
    return formData;
  }

  it("membaca semua pilihan", () => {
    expect(readCategoriesFromForm(form([["categories", "Fashion"], ["categories", "Katering"]]))).toEqual(["Fashion", "Katering"]);
  });

  it("menambahkan kategori tulisan sendiri", () => {
    expect(readCategoriesFromForm(form([["categories", "Fashion"], ["customCategory", "Jasa jahit"]]))).toEqual(["Fashion", "Jasa jahit"]);
  });

  it("mempertahankan kotak Lainnya yang kosong agar ditolak validasi", () => {
    expect(readCategoriesFromForm(form([["customCategory", ""]]))).toEqual([""]);
  });

  it("mengabaikan nilai bukan teks", () => {
    const formData = new FormData();
    formData.append("categories", new File(["x"], "x.txt"));
    expect(readCategoriesFromForm(formData)).toEqual([]);
  });
});
