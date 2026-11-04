"use client";

import { useActionState } from "react";
import { SelectField, TextField, UnitsField } from "@/components/form-field";
import { FormMessage, PRIMARY_BUTTON_CLASS } from "@/components/form-message";
import { initialFormState } from "@/lib/form-state";
import { submitWithoutReset } from "@/lib/submit-without-reset";
import { createManualOrderAction } from "@/features/orders/actions";

type ManualOrderFormProps = {
  preorderId: string;
  /** Dibuat sekali per halaman: klik ganda atau kirim ulang tidak membuat pesanan kedua. */
  idempotencyKey: string;
  quantityHint: string;
};

export function ManualOrderForm({ preorderId, idempotencyKey, quantityHint }: ManualOrderFormProps) {
  const [state, formAction, isPending] = useActionState(createManualOrderAction, initialFormState);

  return (
    <form action={formAction} onSubmit={submitWithoutReset(formAction)} className="flex flex-col gap-4" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="preorderId" value={preorderId} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <TextField
        name="customerName"
        label="Nama pemesan"
        required
        maxLength={160}
        autoComplete="off"
        defaultValue={state.values?.customerName}
        errors={state.fieldErrors?.customerName}
      />
      <UnitsField
        name="quantity"
        label="Jumlah (unit)"
        required
        hint={quantityHint}
        defaultValue={state.values?.quantity}
        errors={state.fieldErrors?.quantity}
      />
      <SelectField
        name="paymentStatus"
        label="Status pembayaran"
        required
        hint="Pembayaran di luar aplikasi, misalnya tunai atau transfer. Slot tetap terpakai walau belum lunas."
        defaultValue={state.values?.paymentStatus ?? ""}
        errors={state.fieldErrors?.paymentStatus}
      >
        <option value="">Pilih status pembayaran</option>
        <option value="unpaid">Belum dibayar</option>
        <option value="paid">Sudah lunas</option>
      </SelectField>
      <TextField
        name="customerContact"
        label="Kontak (opsional)"
        maxLength={120}
        autoComplete="off"
        hint="Contoh: WhatsApp 0812-xxxx."
        defaultValue={state.values?.customerContact}
        errors={state.fieldErrors?.customerContact}
      />
      <TextField
        name="customerEmail"
        label="Email (opsional)"
        type="email"
        autoComplete="off"
        defaultValue={state.values?.customerEmail}
        errors={state.fieldErrors?.customerEmail}
      />
      <button type="submit" className={PRIMARY_BUTTON_CLASS} disabled={isPending}>
        {isPending ? "Menyimpan…" : "Simpan pesanan"}
      </button>
    </form>
  );
}
