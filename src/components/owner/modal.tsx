"use client";

import { X } from "lucide-react";
import { useEffect, useId, useRef, type ReactNode } from "react";

/**
 * Modal memakai <dialog> bawaan: fokus terkunci di dalam, Esc menutup, dan pembaca layar mengenalinya tanpa library.
 * Klik di luar kotak juga menutup.
 */
export function Modal({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
      className="m-auto max-h-[calc(100dvh-32px)] w-[min(640px,calc(100vw-32px))] rounded-[16px] border border-line bg-surface p-0 text-ink shadow-[0_24px_48px_-24px_rgba(15,23,42,.45)] backdrop:bg-ink/45"
    >
      <div className="flex max-h-[calc(100dvh-32px)] flex-col">
        <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <h2 id={titleId} className="min-w-0 text-lg font-semibold break-words text-ink">{title}</h2>
          <button type="button" aria-label="Tutup" onClick={onClose}
            className="inline-flex size-10 shrink-0 items-center justify-center rounded-[10px] text-muted transition-colors hover:bg-subtle hover:text-ink">
            <X aria-hidden size={20} strokeWidth={2} />
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="border-t border-line px-5 py-4">{footer}</div>}
      </div>
    </dialog>
  );
}
