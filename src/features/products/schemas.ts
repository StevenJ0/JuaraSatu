import { z } from "zod";

export const COST_QUALITIES = ["unknown", "estimated", "verified"] as const;
export type CostQuality = (typeof COST_QUALITIES)[number];

export const COST_QUALITY_LABELS: Record<CostQuality, string> = {
  unknown: "Belum diketahui",
  estimated: "Perkiraan",
  verified: "Sudah dicek",
};

const MAX_IDR = 1_000_000_000;
const DESCRIPTION_MAX = 1000;

// Menerima 25000, 25.000, atau Rp25.000. Bentuk seperti 25.5 ditolak agar tidak terbaca sebagai 255.
const IDR_PATTERN = /^(?:Rp\s?)?(\d+|\d{1,3}(?:\.\d{3})+)$/i;

export function parseIdr(value: string): number | null {
  const digits = IDR_PATTERN.exec(value)?.[1];
  if (digits === undefined) return null;
  const amount = Number(digits.replaceAll(".", ""));
  return amount <= MAX_IDR ? amount : null;
}

/**
 * Field produk yang diisi owner (schema v2.1 §5.1). SKU dibuat server (`sku.ts`), foto divalidasi di `photo.ts`.
 * Biaya kosong berarti belum diketahui dan berbeda dengan Rp0, sehingga wajib cocok dengan status biaya.
 */
export const productSchema = z
  .object({
    name: z.string().trim().min(1, "Nama produk wajib diisi").max(160, "Maksimal 160 karakter"),
    description: z
      .string()
      .trim()
      .max(DESCRIPTION_MAX, `Maksimal ${DESCRIPTION_MAX} karakter`)
      .transform((value) => (value === "" ? null : value)),
    basePrice: z.string().trim(),
    costQuality: z.enum(COST_QUALITIES, { error: "Pilih status biaya" }),
    variableCost: z.string().trim(),
  })
  .transform(({ basePrice, variableCost, ...fields }, context) => {
    const basePriceIdr = parseIdr(basePrice);
    if (basePriceIdr === null || basePriceIdr === 0) {
      context.addIssue({ code: "custom", path: ["basePrice"], message: "Isi harga dalam rupiah, lebih dari 0" });
    }

    let variableCostIdr: number | null = null;
    if (fields.costQuality === "unknown") {
      if (variableCost !== "") {
        context.addIssue({
          code: "custom",
          path: ["variableCost"],
          message: "Kosongkan biaya bila statusnya belum diketahui",
        });
      }
    } else {
      variableCostIdr = parseIdr(variableCost);
      if (variableCostIdr === null) {
        context.addIssue({ code: "custom", path: ["variableCost"], message: "Isi biaya dalam rupiah, boleh 0" });
      }
    }

    if (basePriceIdr === null) return z.NEVER;
    return { ...fields, basePriceIdr, variableCostIdr };
  });

export type ProductInput = z.output<typeof productSchema>;

export const PRODUCT_FIELDS = ["name", "description", "basePrice", "costQuality", "variableCost"] as const;

/** Identitas baris yang diubah: id dari URL/form dan versi yang dilihat owner, untuk mendeteksi perubahan bersamaan. */
export const productRefSchema = z.object({
  productId: z.uuid(),
  version: z.coerce.number().int().min(1),
});
