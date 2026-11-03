/** Hanya pilihan di form; `businesses.categories` tetap teks bebas agar usaha di luar daftar bisa menulis sendiri. */
export const BUSINESS_CATEGORIES = [
  "Buku & alat tulis",
  "Elektronik & gadget",
  "Fashion",
  "Furnitur & dekorasi",
  "Hijab & busana muslim",
  "Ibu & bayi",
  "Katering",
  "Kecantikan",
  "Kerajinan",
  "Kesehatan & herbal",
  "Kue & camilan",
  "Mainan & hobi",
  "Makanan & minuman",
  "Merchandise",
  "Pertanian & perkebunan",
  "Rumah tangga",
  "Sablon & percetakan",
  "Sepatu, tas & aksesori",
] as const;

/** Sama dengan batas di constraint `businesses_categories_valid`. */
export const MAX_BUSINESS_CATEGORIES = 3;

export const OTHER_CATEGORY_LABEL = "Lainnya";

/** Nilai awal form. Form hanya punya satu kotak "Lainnya", jadi hanya kategori di luar daftar yang pertama yang dipakai. */
export function toCategorySelection(categories: readonly string[]): { selected: string[]; customCategory: string } {
  const selected: string[] = [];
  let customCategory = "";

  for (const category of categories) {
    const listed = BUSINESS_CATEGORIES.find((option) => option.toLowerCase() === category.trim().toLowerCase());
    if (listed) selected.push(listed);
    else if (!customCategory) customCategory = category.trim();
  }
  return { selected, customCategory };
}

/** Kotak `customCategory` hanya terkirim saat "Lainnya" dipilih, sehingga isinya yang kosong tetap ditolak validasi. */
export function readCategoriesFromForm(formData: FormData): string[] {
  const selected = formData.getAll("categories").filter((value): value is string => typeof value === "string");
  const customCategory = formData.get("customCategory");
  return typeof customCategory === "string" ? [...selected, customCategory] : selected;
}
