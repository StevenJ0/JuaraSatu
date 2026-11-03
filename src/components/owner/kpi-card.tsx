import { Card } from "@/components/owner/card";

export function KpiCard({
  label,
  value,
  note,
  className = "",
}: {
  label: string;
  value: string;
  note: string;
  className?: string;
}) {
  return (
    <Card className={className}>
      <p className="text-sm font-medium text-muted">{label}</p>
      <p className="mt-1 text-[28px]/[34px] font-bold text-ink">{value}</p>
      <p className="mt-1 text-sm text-muted">{note}</p>
    </Card>
  );
}
