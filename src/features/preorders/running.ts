import { diagnoseTarget, type TargetPace } from "@/features/campaign-strategist/target-diagnosis";
import type { Preorder } from "@/features/preorders/repository";

export type RunningPhase = "not_started" | "open" | "past_end";

export type RunningPreorder = {
  id: string;
  name: string;
  productName: string;
  paidUnits: number;
  targetUnits: number;
  orderableUnits: number;
  endsAt: string;
  startsAt: string;
  phase: RunningPhase;
  /** Null sebelum dibuka, karena laju belum bisa dinilai. */
  pace: TargetPace | null;
  /** Lebar progres terhadap target, dibatasi 100. */
  targetPercent: number;
  /** Pemesanan masih dibuka tapi lajunya di bawah kebutuhan, jadi pantas ditawari Campaign AI. */
  needsStrategy: boolean;
};

type RunningInput = Pick<Preorder, "id" | "name" | "productName" | "status" | "targetUnits" | "startsAt" | "endsAt" | "intakeCutoffAt"> & {
  metrics: Pick<Preorder["metrics"], "paidUnits" | "orderableUnits">;
};

/** Pemesanan ditutup oleh yang lebih dulu: waktu tutup preorder atau batas pesan jadwal produksi. */
function closesAt(preorder: RunningInput): string {
  return Date.parse(preorder.endsAt) < Date.parse(preorder.intakeCutoffAt) ? preorder.endsAt : preorder.intakeCutoffAt;
}

/** Preorder terbit untuk Ringkasan: yang perlu strategi lebih dulu, lalu yang paling cepat ditutup. Semua angka dari kode, bukan AI. */
export function summarizeRunningPreorders(preorders: readonly RunningInput[], now: Date): RunningPreorder[] {
  const time = now.getTime();
  return preorders
    .filter((preorder) => preorder.status === "published")
    .map((preorder): RunningPreorder => {
      const endsAt = closesAt(preorder);
      const phase: RunningPhase = time < Date.parse(preorder.startsAt) ? "not_started" : time >= Date.parse(endsAt) ? "past_end" : "open";
      const { paidUnits, orderableUnits } = preorder.metrics;
      const pace = phase === "not_started"
        ? null
        : diagnoseTarget({ targetUnits: preorder.targetUnits, paidUnits, startsAt: preorder.startsAt, endsAt, now: now.toISOString() }).pace;
      return {
        id: preorder.id,
        name: preorder.name,
        productName: preorder.productName,
        paidUnits,
        targetUnits: preorder.targetUnits,
        orderableUnits,
        startsAt: preorder.startsAt,
        endsAt,
        phase,
        pace,
        targetPercent: preorder.targetUnits > 0 ? Math.min((paidUnits / preorder.targetUnits) * 100, 100) : 100,
        needsStrategy: phase === "open" && (pace === "behind" || pace === "far_behind"),
      };
    })
    .sort((a, b) => Number(b.needsStrategy) - Number(a.needsStrategy) || Date.parse(a.endsAt) - Date.parse(b.endsAt));
}
