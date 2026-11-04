import { formatDateOnly, formatWibDateTime, parseWibDateTime } from "@/lib/wib-time";

const SUGGESTED_CUTOFF_TIME = "20:00";
const SUGGESTED_PICKUP_END_TIME = "17:00";
const DAY_MS = 24 * 60 * 60 * 1000;

/** Satu kapasitas mewakili satu tanggal, jadi form hanya menanyakan jam pengambilan dan server menggabungkannya. */
export function combineWindowEnd(fulfillmentDate: string, endTime: string): string {
  return `${fulfillmentDate}T${endTime}`;
}

/**
 * Isian awal setelah tanggal pengambilan dipilih: batas pesan malam sebelumnya. Bila waktu itu sudah lewat,
 * batas pesan dikosongkan agar pemilik memilih sendiri, bukan mendapat nilai yang pasti ditolak.
 */
export function suggestCapacitySchedule(fulfillmentDate: string, now: Date): { intakeCutoff: string; endTime: string } {
  const pickupDay = Date.parse(`${fulfillmentDate}T00:00:00Z`);
  if (Number.isNaN(pickupDay)) return { intakeCutoff: "", endTime: SUGGESTED_PICKUP_END_TIME };

  const dayBefore = new Date(pickupDay - DAY_MS).toISOString().slice(0, 10);
  const intakeCutoff = `${dayBefore}T${SUGGESTED_CUTOFF_TIME}`;
  const cutoffInstant = parseWibDateTime(intakeCutoff);
  const isStillAhead = cutoffInstant !== null && Date.parse(cutoffInstant) > now.getTime();
  return { intakeCutoff: isStillAhead ? intakeCutoff : "", endTime: SUGGESTED_PICKUP_END_TIME };
}

/** Kalimat ringkasan agar pemilik bisa memeriksa jadwal tanpa membaca tiga kolom. Null bila isian belum lengkap atau tidak sah. */
export function describeCapacitySchedule(fulfillmentDate: string, intakeCutoff: string, endTime: string): string | null {
  const cutoffInstant = parseWibDateTime(intakeCutoff);
  const windowEndInstant = parseWibDateTime(combineWindowEnd(fulfillmentDate, endTime));
  if (!cutoffInstant || !windowEndInstant) return null;

  return `Pembeli bisa memesan sampai ${formatWibDateTime(cutoffInstant)}, lalu mengambil pesanan pada ${formatDateOnly(fulfillmentDate)} paling lambat pukul ${endTime.replace(":", ".")} WIB.`;
}
