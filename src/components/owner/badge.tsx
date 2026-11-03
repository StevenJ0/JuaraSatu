import type { ReactNode } from "react";

export type BadgeTone = "success" | "warning" | "danger" | "neutral";

const TONE_CLASS: Record<BadgeTone, string> = {
  success: "bg-[var(--owner-success-bg)] text-[color:var(--owner-success-fg)]",
  warning: "bg-[var(--owner-warning-bg)] text-[color:var(--owner-warning-fg)]",
  danger: "bg-[var(--owner-danger-bg)] text-[color:var(--owner-danger-fg)]",
  neutral: "bg-subtle text-muted",
};

/** Selalu berisi kata; warna hanya memperkuat, bukan satu-satunya penanda status. */
export function Badge({ tone, children }: { tone: BadgeTone; children: ReactNode }) {
  return (
    <span className={`inline-flex shrink-0 items-center rounded-full px-2 py-1 text-xs font-semibold ${TONE_CLASS[tone]}`}>
      {children}
    </span>
  );
}
