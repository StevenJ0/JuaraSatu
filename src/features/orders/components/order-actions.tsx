"use client";

import { useActionState, useState } from "react";
import { TextAreaField } from "@/components/form-field";
import { DANGER_BUTTON_CLASS, FormMessage, PRIMARY_BUTTON_CLASS, SECONDARY_BUTTON_CLASS } from "@/components/form-message";
import { initialFormState } from "@/lib/form-state";
import { advanceOrderAction, cancelOrderAction, expireOrderAction } from "@/features/orders/actions";
import type { NextOrderStep } from "@/features/orders/status";

type OrderRef = { orderId: string; version: number };

function OrderRefInputs({ orderId, version }: OrderRef) {
  return (
    <>
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name="version" value={version} />
    </>
  );
}

export function AdvanceOrderButton({ orderId, version, step }: OrderRef & { step: NextOrderStep }) {
  const [state, formAction, isPending] = useActionState(advanceOrderAction, initialFormState);
  return (
    <form action={formAction} className="flex flex-col gap-3">
      <FormMessage state={state} />
      <OrderRefInputs orderId={orderId} version={version} />
      <input type="hidden" name="action" value={step.action} />
      <button type="submit" className={`w-full sm:w-fit ${PRIMARY_BUTTON_CLASS}`} disabled={isPending}>
        {isPending ? "Menyimpan…" : step.label}
      </button>
    </form>
  );
}

export function ExpireOrderButton({ orderId, version }: OrderRef) {
  const [state, formAction, isPending] = useActionState(expireOrderAction, initialFormState);
  return (
    <form action={formAction} className="flex flex-col gap-3">
      <FormMessage state={state} />
      <OrderRefInputs orderId={orderId} version={version} />
      <button type="submit" className={`w-full sm:w-fit ${PRIMARY_BUTTON_CLASS}`} disabled={isPending}>
        {isPending ? "Menyimpan…" : "Lepas slot"}
      </button>
    </form>
  );
}

/** Pembatalan tidak bisa diurungkan, jadi lewat dua langkah dan wajib alasan. */
export function CancelOrderForm({ orderId, version, warning }: OrderRef & { warning: string }) {
  const [state, formAction, isPending] = useActionState(cancelOrderAction, initialFormState);
  const [isOpen, setIsOpen] = useState(false);

  if (!isOpen) {
    return (
      <button type="button" className={`w-full sm:w-fit ${SECONDARY_BUTTON_CLASS}`} onClick={() => setIsOpen(true)}>
        Batalkan pesanan
      </button>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-3" noValidate>
      <FormMessage state={state} />
      <OrderRefInputs orderId={orderId} version={version} />
      <p className="max-w-[65ch] rounded-[10px] bg-[var(--owner-warning-bg)] px-3 py-2 text-base text-[color:var(--owner-warning-fg)]">{warning}</p>
      <TextAreaField
        name="reason"
        label="Alasan pembatalan"
        required
        maxLength={500}
        defaultValue={state.values?.reason}
        errors={state.fieldErrors?.reason}
      />
      <div className="flex flex-wrap gap-2">
        <button type="submit" className={DANGER_BUTTON_CLASS} disabled={isPending}>
          {isPending ? "Memproses…" : "Ya, batalkan pesanan"}
        </button>
        <button type="button" className={SECONDARY_BUTTON_CLASS} disabled={isPending} onClick={() => setIsOpen(false)}>
          Kembali
        </button>
      </div>
    </form>
  );
}
