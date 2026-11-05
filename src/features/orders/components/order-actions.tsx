"use client";

import { useActionState, useState } from "react";
import { SelectField, TextAreaField, TextField } from "@/components/form-field";
import { DANGER_BUTTON_CLASS, FormMessage, PRIMARY_BUTTON_CLASS, SECONDARY_BUTTON_CLASS } from "@/components/form-message";
import { initialFormState } from "@/lib/form-state";
import { submitWithoutReset } from "@/lib/submit-without-reset";
import {
  acceptLatePaymentAction,
  advanceOrderAction,
  cancelOrderAction,
  declineLatePaymentAction,
  expireOrderAction,
  resolveProductionCostAction,
} from "@/features/orders/actions";
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

/** Hanya tampil selama biaya belum diketahui, dan sekali disimpan tidak bisa diubah lagi lewat form ini. */
export function ResolveProductionCostForm({ orderId, version }: OrderRef) {
  const [state, formAction, isPending] = useActionState(resolveProductionCostAction, initialFormState);

  return (
    <form action={formAction} onSubmit={submitWithoutReset(formAction)} className="mt-4 flex flex-col gap-3" noValidate>
      <FormMessage state={state} />
      <OrderRefInputs orderId={orderId} version={version} />
      <TextField
        name="costPerUnit"
        label="Biaya per unit"
        required
        inputMode="numeric"
        autoComplete="off"
        hint="Contoh: 75.000. Isi 0 bila memang tidak ada biaya."
        defaultValue={state.values?.costPerUnit}
        errors={state.fieldErrors?.costPerUnit}
      />
      <SelectField name="quality" label="Status biaya" required defaultValue={state.values?.quality ?? ""} errors={state.fieldErrors?.quality}>
        <option value="">Pilih status biaya</option>
        <option value="estimated">Perkiraan</option>
        <option value="verified">Sudah dicek</option>
      </SelectField>
      <TextAreaField
        name="note"
        label="Catatan asal biaya"
        required
        maxLength={500}
        hint="Contoh: dari nota bahan 3 November."
        defaultValue={state.values?.note}
        errors={state.fieldErrors?.note}
      />
      <button type="submit" className={`w-full sm:w-fit ${PRIMARY_BUTTON_CLASS}`} disabled={isPending}>
        {isPending ? "Menyimpan…" : "Simpan biaya"}
      </button>
    </form>
  );
}

/** Menerima berarti memakai slot lagi dan mengirim email konfirmasi, jadi lewat dua langkah. */
export function AcceptLatePaymentForm({ orderId, version, paymentId }: OrderRef & { paymentId: string }) {
  const [state, formAction, isPending] = useActionState(acceptLatePaymentAction, initialFormState);
  const [isConfirming, setIsConfirming] = useState(false);

  if (!isConfirming) {
    return (
      <div className="flex flex-col gap-3">
        <FormMessage state={state} />
        <button type="button" className={`w-full sm:w-fit ${PRIMARY_BUTTON_CLASS}`} onClick={() => setIsConfirming(true)}>
          Terima pembayaran
        </button>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <FormMessage state={state} />
      <OrderRefInputs orderId={orderId} version={version} />
      <input type="hidden" name="paymentId" value={paymentId} />
      <p className="max-w-[65ch] rounded-[10px] bg-[var(--owner-warning-bg)] px-3 py-2 text-base text-[color:var(--owner-warning-fg)]">
        Pesanan kembali aktif dan memakai slot lagi, lalu pembeli menerima email konfirmasi. Sisa kuota dan kapasitas dicek ulang.
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="submit" className={PRIMARY_BUTTON_CLASS} disabled={isPending}>
          {isPending ? "Memproses…" : "Ya, terima pembayaran"}
        </button>
        <button type="button" className={SECONDARY_BUTTON_CLASS} disabled={isPending} onClick={() => setIsConfirming(false)}>
          Tidak jadi
        </button>
      </div>
    </form>
  );
}

/** Fakta pembayaran tetap tersimpan, jadi yang diminta adalah catatan tindak lanjut untuk pemilik. */
export function DeclineLatePaymentForm({ orderId, version }: OrderRef) {
  const [state, formAction, isPending] = useActionState(declineLatePaymentAction, initialFormState);
  const [isOpen, setIsOpen] = useState(false);

  if (!isOpen) {
    return (
      <button type="button" className={`w-full sm:w-fit ${SECONDARY_BUTTON_CLASS}`} onClick={() => setIsOpen(true)}>
        Tidak diterima
      </button>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-3" noValidate>
      <FormMessage state={state} />
      <OrderRefInputs orderId={orderId} version={version} />
      <p className="max-w-[65ch] rounded-[10px] bg-[var(--owner-warning-bg)] px-3 py-2 text-base text-[color:var(--owner-warning-fg)]">
        Pesanan tetap batal dan slot tidak dipakai. Hubungi pembeli untuk tindak lanjutnya di luar aplikasi.
      </p>
      <TextAreaField name="note" label="Catatan tindak lanjut" required maxLength={500} defaultValue={state.values?.note} errors={state.fieldErrors?.note} />
      <div className="flex flex-wrap gap-2">
        <button type="submit" className={DANGER_BUTTON_CLASS} disabled={isPending}>
          {isPending ? "Memproses…" : "Ya, tidak diterima"}
        </button>
        <button type="button" className={SECONDARY_BUTTON_CLASS} disabled={isPending} onClick={() => setIsOpen(false)}>
          Kembali
        </button>
      </div>
    </form>
  );
}

/** Pembatalan tidak bisa diurungkan, jadi lewat dua langkah dan wajib alasan. */
export function CancelOrderForm({ orderId, version, warning, requiresRefundNote }: OrderRef & { warning: string; requiresRefundNote: boolean }) {
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
    <form action={formAction} onSubmit={submitWithoutReset(formAction)} className="flex flex-col gap-3" noValidate>
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
      {requiresRefundNote && (
        <TextAreaField
          name="refundNote"
          label="Catatan pengembalian"
          required
          maxLength={500}
          hint="Pengembalian dilakukan di luar aplikasi. Catat apa yang sudah atau akan dilakukan."
          defaultValue={state.values?.refundNote}
          errors={state.fieldErrors?.refundNote}
        />
      )}
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
