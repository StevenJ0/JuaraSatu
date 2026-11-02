import { z } from "zod";

/** Batas panjang teks bebas di sisi aplikasi; kolom `text` di schema tidak membatasi, tapi input tetap perlu batas wajar. */
const LONG_TEXT_MAX = 1000;

function optionalText(max: number) {
  return z
    .string()
    .trim()
    .max(max, `Maksimal ${max} karakter`)
    .transform((value) => (value === "" ? null : value));
}

/**
 * Field profil usaha yang boleh diisi owner (schema v2.1 §4.2). `slug`, `timezone`, dan `is_demo` ditentukan server,
 * dan sengaja tidak ada field rekening/merchant (FR-AUTH-02).
 */
export const businessProfileSchema = z.object({
  name: z.string().trim().min(1, "Nama usaha wajib diisi").max(120, "Maksimal 120 karakter"),
  category: z.string().trim().min(1, "Kategori wajib diisi").max(80, "Maksimal 80 karakter"),
  description: optionalText(LONG_TEXT_MAX),
  publicContact: optionalText(120),
  // Wajib di schema v2.1 (`pickup_instructions text NOT NULL`): MVP pickup-only, pembeli harus tahu cara mengambil pesanan.
  pickupInstructions: z
    .string()
    .trim()
    .min(1, "Petunjuk pengambilan wajib diisi")
    .max(LONG_TEXT_MAX, `Maksimal ${LONG_TEXT_MAX} karakter`),
});

export type BusinessProfileInput = z.infer<typeof businessProfileSchema>;

export const BUSINESS_PROFILE_FIELDS = [
  "name",
  "category",
  "description",
  "publicContact",
  "pickupInstructions",
] as const;
