"use client";

import { Info } from "lucide-react";
import { useId } from "react";

const ALIGN_CLASS = { start: "left-0", center: "left-1/2 -translate-x-1/2", end: "right-0" } as const;

/**
 * Ikon (i) dengan penjelasan singkat. Muncul saat disorot kursor atau difokus (ketuk di HP, Tab di keyboard),
 * jadi tidak bergantung pada hover saja. Saat tersembunyi memakai display none, bukan visibility, karena elemen
 * tak terlihat tetap ikut melebarkan halaman dan memunculkan scroll horizontal.
 */
export function InfoTip({ label, children, align = "start" }: { label: string; children: string; align?: keyof typeof ALIGN_CLASS }) {
  const id = useId();
  // align menentukan arah melebarnya penjelasan: "start" ke kanan, "end" ke kiri, "center" ke dua sisi.
  return (
    <span className="group relative inline-flex align-middle">
      <button
        type="button"
        aria-label={`Penjelasan ${label}`}
        aria-describedby={id}
        className="inline-flex size-6 items-center justify-center rounded-full text-muted transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand"
      >
        <Info aria-hidden size={15} strokeWidth={2} />
      </button>
      <span
        role="tooltip"
        id={id}
        className={`pointer-events-none absolute bottom-full ${ALIGN_CLASS[align]} z-30 mb-1.5 hidden w-48 rounded-[10px] bg-ink px-3 py-2 text-sm leading-snug font-normal text-surface shadow-lg group-focus-within:block group-hover:block`}
      >
        {children}
      </span>
    </span>
  );
}
