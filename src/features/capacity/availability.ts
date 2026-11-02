export type ReservationState = "held" | "allocated" | "released";
export type ReservationFact = { quantity: number; state: ReservationState; expiresAt: string | null };
export type CapacityAvailability = { allocated: number; effectiveHeld: number; available: number };

/**
 * Rumus PRD §9.2 untuk tampilan owner. Hold kedaluwarsa tidak dihitung walau cleanup terlambat.
 * Keputusan yang mengikat tetap dihitung di database memakai waktu database.
 */
export function summarizeCapacity(totalUnits: number, reservations: ReservationFact[], now: Date): CapacityAvailability {
  let allocated = 0;
  let effectiveHeld = 0;
  for (const reservation of reservations) {
    if (reservation.state === "allocated") allocated += reservation.quantity;
    const isActiveHold =
      reservation.state === "held" && reservation.expiresAt !== null && Date.parse(reservation.expiresAt) > now.getTime();
    if (isActiveHold) effectiveHeld += reservation.quantity;
  }
  return { allocated, effectiveHeld, available: totalUnits - allocated - effectiveHeld };
}
