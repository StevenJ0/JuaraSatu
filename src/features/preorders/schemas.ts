import { z } from "zod";
import { wibDateTime } from "@/features/capacity/schemas";

// Batas aplikasi mengikuti batas kuantitas P0 (PRD §9.1).
const MAX_UNITS = 10_000;

function positiveUnits(message: string) {
  return z
    .string()
    .trim()
    .regex(/^[1-9]\d*$/, message)
    .transform(Number)
    .refine((value) => value <= MAX_UNITS, `Maksimal ${MAX_UNITS} unit`);
}

export const preorderSchema = z
  .object({
    name: z.string().trim().min(1, "Nama preorder wajib diisi").max(160, "Maksimal 160 karakter"),
    capacityId: z.uuid("Pilih jadwal produksi"),
    targetUnits: positiveUnits("Isi target dengan angka bulat, minimal 1"),
    quotaUnits: positiveUnits("Isi kuota dengan angka bulat, minimal 1"),
    startsAt: wibDateTime("Isi waktu mulai"),
    endsAt: wibDateTime("Isi waktu tutup"),
  })
  .refine((value) => value.quotaUnits >= value.targetUnits, {
    path: ["quotaUnits"],
    message: "Kuota tidak boleh lebih kecil dari target",
  })
  .refine((value) => Date.parse(value.startsAt) < Date.parse(value.endsAt), {
    path: ["endsAt"],
    message: "Waktu tutup harus setelah waktu mulai",
  });

export type PreorderInput = z.output<typeof preorderSchema>;

export const PREORDER_FIELDS = ["name", "capacityId", "targetUnits", "quotaUnits", "startsAt", "endsAt"] as const;

export const preorderRefSchema = z.object({
  preorderId: z.uuid(),
  version: z.coerce.number().int().min(1),
});
