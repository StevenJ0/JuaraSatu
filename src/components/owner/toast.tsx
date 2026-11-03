"use client";

import { CircleCheck } from "lucide-react";
import { useEffect } from "react";

const TOAST_DURATION_MS = 4000;

export function Toast({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, TOAST_DURATION_MS);
    return () => clearTimeout(timer);
  }, [onDismiss]);

  return (
    <p
      role="status"
      className="fixed inset-x-4 bottom-4 z-30 flex items-center gap-2 rounded-[10px] bg-[var(--owner-success-bg)] px-4 py-3 text-base font-medium text-[color:var(--owner-success-fg)] shadow-[0_4px_12px_rgba(15,23,42,.12)] sm:right-6 sm:left-auto sm:max-w-sm"
    >
      <CircleCheck aria-hidden size={18} strokeWidth={1.5} className="shrink-0" />
      {message}
    </p>
  );
}
