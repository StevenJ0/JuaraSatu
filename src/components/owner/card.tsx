import type { ReactNode } from "react";

/** `padded={false}` untuk daftar yang barisnya mengatur jarak sendiri. */
export function Card({ children, className = "", padded = true }: { children: ReactNode; className?: string; padded?: boolean }) {
  return (
    <div
      className={`rounded-[14px] border border-line bg-surface shadow-[0_1px_2px_rgba(15,23,42,.06)] ${padded ? "p-4 sm:p-6" : ""} ${className}`}
    >
      {children}
    </div>
  );
}
