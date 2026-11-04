"use client";

import { useActionState, useState } from "react";
import { FormMessage, PRIMARY_BUTTON_CLASS, SECONDARY_BUTTON_CLASS } from "@/components/form-message";
import { initialFormState, type FormState } from "@/lib/form-state";

type PreorderTransitionProps = {
  action: (previous: FormState, formData: FormData) => Promise<FormState>;
  preorderId: string;
  version: number;
  label: string;
  /** Akibat yang tidak bisa dibatalkan, tampil sebelum pemilik mengonfirmasi. */
  warning: string;
};

/** Perubahan status tidak bisa dibatalkan, jadi selalu lewat dua langkah. */
export function PreorderTransition({ action, preorderId, version, label, warning }: PreorderTransitionProps) {
  const [state, formAction, isPending] = useActionState(action, initialFormState);
  const [isConfirming, setIsConfirming] = useState(false);

  if (!isConfirming) {
    return (
      <div className="flex flex-col gap-3">
        <FormMessage state={state} />
        <button type="button" className={`w-full sm:w-fit ${PRIMARY_BUTTON_CLASS}`} onClick={() => setIsConfirming(true)}>
          {label}
        </button>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="preorderId" value={preorderId} />
      <input type="hidden" name="version" value={version} />
      <FormMessage state={state} />
      <p className="max-w-[65ch] rounded-[10px] bg-[var(--owner-warning-bg)] px-3 py-2 text-base text-[color:var(--owner-warning-fg)]">{warning}</p>
      <div className="flex flex-wrap gap-2">
        <button type="submit" className={PRIMARY_BUTTON_CLASS} disabled={isPending}>
          {isPending ? "Memproses…" : `Ya, ${label.toLowerCase()}`}
        </button>
        <button type="button" className={SECONDARY_BUTTON_CLASS} disabled={isPending} onClick={() => setIsConfirming(false)}>
          Batal
        </button>
      </div>
    </form>
  );
}
