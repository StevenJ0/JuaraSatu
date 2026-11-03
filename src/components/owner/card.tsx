import type { ReactNode } from "react";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-[14px] border border-line bg-surface p-4 shadow-[0_1px_2px_rgba(15,23,42,.06)] sm:p-6 ${className}`}>
      {children}
    </div>
  );
}
