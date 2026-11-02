import { z } from "zod";
import { isValidDateOnly, parseWibDateTime } from "@/lib/wib-time";

// Batas aplikasi mengikuti batas kuantitas P0 (PRD §9.1).
const MAX_UNITS = 10_000;

function wibDateTime(message: string) {
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
  intakeCutoff: wibDateTime("Isi batas pesan"),
  fulfillmentWindowEnd: wibDateTime("Isi batas pengambilan"),
};

function isCutoffBeforeWindowEnd(value: { intakeCutoff: string; fulfillmentWindowEnd: string }): boolean {
  return Date.parse(value.intakeCutoff) < Date.parse(value.fulfillmentWindowEnd);
}

const CUTOFF_ORDER_ERROR = {
  path: ["fulfillmentWindowEnd"],
  message: "Batas pengambilan harus setelah batas pesan",
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

export const CAPACITY_SCHEDULE_FIELDS = ["totalUnits", "intakeCutoff", "fulfillmentWindowEnd"] as const;
export const CAPACITY_CREATE_FIELDS = ["productId", "fulfillmentDate", ...CAPACITY_SCHEDULE_FIELDS] as const;

export const capacityRefSchema = z.object({
  capacityId: z.uuid(),
  version: z.coerce.number().int().min(1),
});
