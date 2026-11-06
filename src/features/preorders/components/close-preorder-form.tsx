"use client";

import { useActionState, useState } from "react";
import { TextAreaField } from "@/components/form-field";
import { FormMessage, PRIMARY_BUTTON_CLASS, SECONDARY_BUTTON_CLASS } from "@/components/form-message";
import { initialFormState } from "@/lib/form-state";
import { submitWithoutReset } from "@/lib/submit-without-reset";
import { closePreorderAction } from "@/features/preorders/actions";

/** Menutup tidak bisa dibuka lagi, jadi lewat dua langkah dan wajib alasan (PRD §13). */
export function ClosePreorderForm({ preorderId, version }: { preorderId: string; version: number }) {
  const [state, formAction, isPending] = useActionState(closePreorderAction, initialFormState);
  const [isOpen, setIsOpen] = useState(false);

  if (!isOpen) {
    return (
      <button type="button" className={`w-full sm:w-fit ${PRIMARY_BUTTON_CLASS}`} onClick={() => setIsOpen(true)}>
        Tutup preorder
      </button>
    );
  }

  return (
    <form action={formAction} onSubmit={submitWithoutReset(formAction)} className="flex flex-col gap-3" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="preorderId" value={preorderId} />
      <input type="hidden" name="version" value={version} />
      <p className="max-w-[65ch] rounded-[10px] bg-[var(--owner-warning-bg)] px-3 py-2 text-base text-[color:var(--owner-warning-fg)]">
        Preorder yang ditutup tidak bisa dibuka lagi. Pesanan yang sudah masuk tetap berjalan. Bila perlu, buat preorder baru.
      </p>
      <TextAreaField
        name="reason"
        label="Alasan menutup"
        required
        maxLength={500}
        hint="Contoh: kuota produksi sudah cukup. Jangan tulis data pembeli."
        defaultValue={state.values?.reason}
        errors={state.fieldErrors?.reason}
      />
      <div className="flex flex-wrap gap-2">
        <button type="submit" className={PRIMARY_BUTTON_CLASS} disabled={isPending}>
          {isPending ? "Memproses…" : "Ya, tutup preorder"}
        </button>
        <button type="button" className={SECONDARY_BUTTON_CLASS} disabled={isPending} onClick={() => setIsOpen(false)}>
          Tidak jadi
        </button>
      </div>
    </form>
  );
}
