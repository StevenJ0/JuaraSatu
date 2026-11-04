"use client";

import { useActionState, useState } from "react";
import { SelectField, TextField } from "@/components/form-field";
import { FormMessage, PRIMARY_BUTTON_CLASS } from "@/components/form-message";
import { initialFormState, type FormState } from "@/lib/form-state";
import { submitWithoutReset } from "@/lib/submit-without-reset";

export type PreorderCapacityOption = {
  id: string;
  label: string;
  priceLabel: string;
  cutoffLabel: string;
  availableUnits: number;
};

type PreorderFormValues = {
  name: string;
  capacityId: string;
  targetUnits: string;
  quotaUnits: string;
  startsAt: string;
  endsAt: string;
};

type PreorderFormProps = {
  action: (previous: FormState, formData: FormData) => Promise<FormState>;
  submitLabel: string;
  capacityOptions: PreorderCapacityOption[];
  initialValues?: PreorderFormValues;
  /** Diisi saat mengubah draf yang sudah ada. */
  existing?: { preorderId: string; version: number };
};

export function PreorderForm({ action, submitLabel, capacityOptions, initialValues, existing }: PreorderFormProps) {
  const [state, formAction, isPending] = useActionState(action, initialFormState);
  const values = state.values ?? initialValues;
  const [capacityId, setCapacityId] = useState(values?.capacityId ?? "");
  const selected = capacityOptions.find((option) => option.id === capacityId);

  return (
    <form action={formAction} onSubmit={submitWithoutReset(formAction)} className="flex flex-col gap-4" noValidate>
      <FormMessage state={state} />
      {existing && (
        <>
          <input type="hidden" name="preorderId" value={existing.preorderId} />
          <input type="hidden" name="version" value={existing.version} />
        </>
      )}
      <TextField
        name="name"
        label="Nama preorder"
        required
        maxLength={160}
        hint="Tampil ke pembeli. Contoh: Kaos Hitam Batch November."
        defaultValue={values?.name}
        errors={state.fieldErrors?.name}
      />
      <SelectField
        name="capacityId"
        label="Produk dan tanggal pengambilan"
        required
        value={capacityId}
        onChange={(event) => setCapacityId(event.target.value)}
        hint={
          selected
            ? `Harga ${selected.priceLabel} · sisa kapasitas ${selected.availableUnits} unit · batas pesan ${selected.cutoffLabel}`
            : "Hanya jadwal produksi dengan produk aktif yang batas pesannya belum lewat."
        }
        errors={state.fieldErrors?.capacityId}
      >
        <option value="">Pilih jadwal produksi</option>
        {capacityOptions.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </SelectField>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          name="targetUnits"
          label="Target penjualan (unit)"
          required
          inputMode="numeric"
          hint="Bukan syarat produksi. Tidak tercapai pun pesanan tetap berjalan."
          defaultValue={values?.targetUnits}
          errors={state.fieldErrors?.targetUnits}
        />
        <TextField
          name="quotaUnits"
          label="Kuota (unit)"
          required
          inputMode="numeric"
          hint="Batas pesanan. Minimal sama dengan target dan tidak melebihi sisa kapasitas saat diterbitkan."
          defaultValue={values?.quotaUnits}
          errors={state.fieldErrors?.quotaUnits}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          name="startsAt"
          label="Mulai dibuka (WIB)"
          type="datetime-local"
          required
          defaultValue={values?.startsAt}
          errors={state.fieldErrors?.startsAt}
        />
        <TextField
          name="endsAt"
          label="Ditutup (WIB)"
          type="datetime-local"
          required
          hint="Tidak boleh melewati batas pesan jadwal produksi."
          defaultValue={values?.endsAt}
          errors={state.fieldErrors?.endsAt}
        />
      </div>
      <button type="submit" className={PRIMARY_BUTTON_CLASS} disabled={isPending}>
        {isPending ? "Menyimpan…" : submitLabel}
      </button>
    </form>
  );
}
