import { Loader2 } from "lucide-react";
import type { ReactNode } from "react";

/** Isi tombol yang berubah menjadi ikon berputar dan teks proses selama aksinya berjalan. */
export function BusyLabel({ busy, label, busyLabel }: { busy: boolean; label: ReactNode; busyLabel: string }) {
  if (!busy) return <>{label}</>;
  return (
    <span className="inline-flex items-center gap-2">
      <Loader2 aria-hidden size={18} strokeWidth={2} className="shrink-0 motion-safe:animate-spin" />
      {busyLabel}
    </span>
  );
}
