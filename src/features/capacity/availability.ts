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

const NEARLY_FULL_RATIO = 0.9;

/** Angka untuk progress kapasitas; lebar segmen dibatasi agar total tidak melebihi 100%. */
export function describeCapacityUsage(
  totalUnits: number,
  { allocated, effectiveHeld }: Pick<CapacityAvailability, "allocated" | "effectiveHeld">,
): { usedUnits: number; allocatedPercent: number; heldPercent: number; isNearlyFull: boolean } {
  const usedUnits = allocated + effectiveHeld;
  if (totalUnits <= 0) return { usedUnits, allocatedPercent: 0, heldPercent: 0, isNearlyFull: false };

  const allocatedPercent = Math.min((allocated / totalUnits) * 100, 100);
  return {
    usedUnits,
    allocatedPercent,
    heldPercent: Math.min((effectiveHeld / totalUnits) * 100, 100 - allocatedPercent),
    isNearlyFull: usedUnits / totalUnits >= NEARLY_FULL_RATIO,
  };
}

type OpenCapacityFact = { intakeCutoffAt: string; availability: CapacityAvailability };

/** Ringkasan jadwal yang batas pesannya belum lewat. Sisa minus (kapasitas diturunkan pihak lain) dihitung nol. */
export function summarizeOpenCapacities(
  capacities: readonly OpenCapacityFact[],
  now: Date,
): { scheduleCount: number; availableUnits: number } {
  const open = capacities.filter((capacity) => Date.parse(capacity.intakeCutoffAt) > now.getTime());
  return {
    scheduleCount: open.length,
    availableUnits: open.reduce((total, capacity) => total + Math.max(capacity.availability.available, 0), 0),
  };
}
