import { Badge, type BadgeTone } from "@/components/owner/badge";
import type { PreorderStatus } from "@/features/preorders/repository";

const STATUS_BADGES: Record<PreorderStatus, { label: string; tone: BadgeTone }> = {
  draft: { label: "Draf", tone: "neutral" },
  published: { label: "Dibuka", tone: "success" },
  closed: { label: "Ditutup", tone: "neutral" },
  completed: { label: "Selesai", tone: "success" },
  cancelled: { label: "Dibatalkan", tone: "danger" },
};

export function PreorderStatusBadge({ status }: { status: PreorderStatus }) {
  const { label, tone } = STATUS_BADGES[status];
  return <Badge tone={tone}>{label}</Badge>;
}
