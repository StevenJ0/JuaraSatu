import { summarizeCapacity, type CapacityAvailability, type ReservationFact } from "@/features/capacity/availability";

export type PreorderReservationFact = ReservationFact & {
  /**
   * Slot terpakai belum tentu dibayar: pesanan manual bisa belum lunas (`awaiting`), dan pesanan yang
   * dibatalkan setelah produksi tetap memakai slot tapi bukan penjualan (`void`).
   */
  payment: "paid" | "awaiting" | "void";
};

export type PreorderMetrics = {
  paidUnits: number;
  /** Slot yang ditahan pembeli ditambah pesanan manual yang belum lunas. */
  awaitingPaymentUnits: number;
  /** Selisih target dan pesanan dibayar. Bukan jumlah yang bisa dijual; lihat `orderableUnits`. */
  paidTargetGap: number;
  orderableUnits: number;
  /** Bentuk yang sama dengan kapasitas, dengan kuota sebagai total, untuk progress. */
  quotaUsage: CapacityAvailability;
};

function allocatedUnits(reservations: PreorderReservationFact[], payment: PreorderReservationFact["payment"]): number {
  return reservations
    .filter((reservation) => reservation.state === "allocated" && reservation.payment === payment)
    .reduce((total, reservation) => total + reservation.quantity, 0);
}

/** Satu rumus untuk dashboard dan halaman pembeli, agar angkanya tidak berbeda. Tidak pernah minus. */
export function computeOrderableUnits(
  input: {
    quotaUnits: number;
    capacityTotalUnits: number;
    capacityReservations: ReservationFact[];
    preorderReservations: ReservationFact[];
  },
  now: Date,
): number {
  const quotaUsage = summarizeCapacity(input.quotaUnits, input.preorderReservations, now);
  const capacityUsage = summarizeCapacity(input.capacityTotalUnits, input.capacityReservations, now);
  return Math.max(Math.min(capacityUsage.available, quotaUsage.available), 0);
}

/** Rumus PRD §9.2 untuk tampilan pemilik. Keputusan yang mengikat tetap dihitung di database. */
export function summarizePreorder(
  input: {
    targetUnits: number;
    quotaUnits: number;
    capacityTotalUnits: number;
    capacityReservations: ReservationFact[];
    preorderReservations: PreorderReservationFact[];
  },
  now: Date,
): PreorderMetrics {
  const quotaUsage = summarizeCapacity(input.quotaUnits, input.preorderReservations, now);
  const paidUnits = allocatedUnits(input.preorderReservations, "paid");

  return {
    paidUnits,
    awaitingPaymentUnits: quotaUsage.effectiveHeld + allocatedUnits(input.preorderReservations, "awaiting"),
    paidTargetGap: Math.max(input.targetUnits - paidUnits, 0),
    orderableUnits: computeOrderableUnits(input, now),
    quotaUsage,
  };
}
