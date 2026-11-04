import { summarizeCapacity, type CapacityAvailability, type ReservationFact } from "@/features/capacity/availability";

export type PreorderMetrics = {
  paidUnits: number;
  heldUnits: number;
  /** Selisih target dan pesanan dibayar. Bukan jumlah yang bisa dijual; lihat `orderableUnits`. */
  paidTargetGap: number;
  orderableUnits: number;
  /** Bentuk yang sama dengan kapasitas, dengan kuota sebagai total, untuk progress. */
  quotaUsage: CapacityAvailability;
};

/**
 * Rumus PRD §9.2 untuk tampilan pemilik. Keputusan yang mengikat tetap dihitung di database.
 * Reservasi `allocated` dianggap dibayar sampai R4 dan R5 menambahkan status pembayaran.
 */
export function summarizePreorder(
  input: { targetUnits: number; quotaUnits: number; capacityTotalUnits: number; capacityReservations: ReservationFact[]; preorderReservations: ReservationFact[] },
  now: Date,
): PreorderMetrics {
  const quotaUsage = summarizeCapacity(input.quotaUnits, input.preorderReservations, now);
  const capacityUsage = summarizeCapacity(input.capacityTotalUnits, input.capacityReservations, now);
  return {
    paidUnits: quotaUsage.allocated,
    heldUnits: quotaUsage.effectiveHeld,
    paidTargetGap: Math.max(input.targetUnits - quotaUsage.allocated, 0),
    orderableUnits: Math.max(Math.min(capacityUsage.available, quotaUsage.available), 0),
    quotaUsage,
  };
}
