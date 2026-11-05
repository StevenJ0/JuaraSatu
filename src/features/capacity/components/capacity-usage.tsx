import { Badge } from "@/components/owner/badge";
import { describeCapacityUsage, type CapacityAvailability } from "@/features/capacity/availability";

export function CapacityUsage({ totalUnits, availability }: { totalUnits: number; availability: CapacityAvailability }) {
  if (totalUnits <= 0) {
    return (
      <div className="flex">
        <Badge tone="neutral">Tidak berproduksi</Badge>
      </div>
    );
  }

  const { usedUnits, allocatedPercent, heldPercent, isNearlyFull } = describeCapacityUsage(totalUnits, availability);
  const summary = `${usedUnits} dari ${totalUnits} unit terpakai`;
  const fillClass = isNearlyFull ? "bg-[var(--owner-warning-fg)]" : "bg-brand";

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-base font-semibold text-ink">{summary}</p>
        {isNearlyFull && <Badge tone="warning">Hampir penuh</Badge>}
      </div>
      <div
        role="img"
        aria-label={`${summary}, ${availability.effectiveHeld} unit di antaranya ditahan`}
        className={`flex h-2 overflow-hidden rounded-full ${isNearlyFull ? "bg-[var(--owner-warning-bg)]" : "bg-[var(--ui-brand-soft)]"}`}
      >
        <div className={fillClass} style={{ width: `${allocatedPercent}%` }} />
        <div className={`${fillClass} opacity-45`} style={{ width: `${heldPercent}%` }} />
      </div>
      <p className="text-sm text-muted">
        Sisa {availability.available} unit
        {availability.effectiveHeld > 0 && ` · ${availability.effectiveHeld} unit menunggu bayar`}
      </p>
    </div>
  );
}
