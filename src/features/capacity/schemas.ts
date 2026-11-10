import { z } from "zod";
import { isValidDateOnly, parseWibDateTime } from "@/lib/wib-time";

// Batas aplikasi mengikuti batas kuantitas P0 (PRD §9.1).
const MAX_UNITS = 10_000;

export function wibDateTime(message: string) {
  return z
    .string()
    .trim()
    .transform((value, context) => {
      const instant = parseWibDateTime(value);
      if (instant === null) {
        context.addIssue({ code: "custom", message });
        return z.NEVER;
      }
      return instant;
    });
}

const scheduleShape = {
  totalUnits: z
    .string()
    .trim()
    .regex(/^\d+$/, "Isi jumlah unit dengan angka bulat")
    .transform(Number)
    .refine((value) => value <= MAX_UNITS, `Maksimal ${MAX_UNITS} unit`),
  intakeCutoff: wibDateTime("Isi batas melakukan pemesanan"),
  fulfillmentWindowEnd: wibDateTime("Isi jam terakhir pengambilan"),
};

function isCutoffBeforeWindowEnd(value: { intakeCutoff: string; fulfillmentWindowEnd: string }): boolean {
  return Date.parse(value.intakeCutoff) < Date.parse(value.fulfillmentWindowEnd);
}

const CUTOFF_ORDER_ERROR = {
  path: ["fulfillmentWindowEnd"],
  message: "Jam terakhir pengambilan harus setelah batas melakukan pemesanan",
};

/** Field yang boleh diubah setelah kapasitas dibuat; produk dan tanggal tetap (schema v2.1 §5.2). */
export const capacityScheduleSchema = z.object(scheduleShape).refine(isCutoffBeforeWindowEnd, CUTOFF_ORDER_ERROR);

export const capacityCreateSchema = z
  .object({
    productId: z.uuid("Pilih produk"),
    fulfillmentDate: z.string().trim().refine(isValidDateOnly, "Isi tanggal pengambilan"),
    ...scheduleShape,
  })
  .refine(isCutoffBeforeWindowEnd, CUTOFF_ORDER_ERROR);

export type CapacityScheduleInput = z.output<typeof capacityScheduleSchema>;
export type CapacityCreateInput = z.output<typeof capacityCreateSchema>;

/** Nama kolom form. `fulfillmentWindowEnd` untuk skema dibentuk di server dari tanggal dan jam ini. */
export const CAPACITY_SCHEDULE_FIELDS = ["fulfillmentDate", "totalUnits", "intakeCutoff", "fulfillmentWindowEndTime"] as const;
export const CAPACITY_CREATE_FIELDS = ["productId", ...CAPACITY_SCHEDULE_FIELDS] as const;

export const capacityRefSchema = z.object({
  capacityId: z.uuid(),
  version: z.coerce.number().int().min(1),
});
