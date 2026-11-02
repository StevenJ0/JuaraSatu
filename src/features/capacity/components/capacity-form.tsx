"use client";

import { useActionState } from "react";
import { SelectField, TextField } from "@/components/form-field";
import { FormMessage, PRIMARY_BUTTON_CLASS } from "@/components/form-message";
import { initialFormState, type FormState } from "@/lib/form-state";

type CapacityScheduleValues = {
  totalUnits: string;
  intakeCutoff: string;
  fulfillmentWindowEnd: string;
};

type CapacityFormProps = {
  action: (previous: FormState, formData: FormData) => Promise<FormState>;
  submitLabel: string;
  totalUnitsHint: string;
  initialValues?: CapacityScheduleValues;
  /** Diisi saat membuat kapasitas; produk dan tanggal tidak bisa diubah setelah dibuat. */
  products?: { id: string; name: string }[];
  /** Diisi saat mengubah kapasitas yang sudah ada. */
  existing?: { capacityId: string; version: number };
};

export function CapacityForm({ action, submitLabel, totalUnitsHint, initialValues, products, existing }: CapacityFormProps) {
  const [state, formAction, isPending] = useActionState(action, initialFormState);
  const values = state.values ?? initialValues;

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      <FormMessage state={state} />
      {existing && (
        <>
          <input type="hidden" name="capacityId" value={existing.capacityId} />
          <input type="hidden" name="version" value={existing.version} />
        </>
      )}
      {products && (
        <>
          <SelectField
            name="productId"
            label="Produk"
            required
            defaultValue={state.values?.productId ?? ""}
            errors={state.fieldErrors?.productId}
          >
            <option value="">Pilih produk</option>
            {products.map((product) => (
              <option key={product.id} value={product.id}>
                {product.name}
              </option>
            ))}
          </SelectField>
          <TextField
            name="fulfillmentDate"
            label="Tanggal pengambilan"
            type="date"
            required
            defaultValue={state.values?.fulfillmentDate}
            errors={state.fieldErrors?.fulfillmentDate}
          />
        </>
      )}
      <TextField
        name="totalUnits"
        label="Jumlah unit yang bisa diproduksi"
        required
        inputMode="numeric"
        hint={totalUnitsHint}
        defaultValue={values?.totalUnits}
        errors={state.fieldErrors?.totalUnits}
      />
      <TextField
        name="intakeCutoff"
        label="Batas pesan (WIB)"
        type="datetime-local"
        required
        hint="Setelah waktu ini, pesanan baru tidak diterima."
        defaultValue={values?.intakeCutoff}
        errors={state.fieldErrors?.intakeCutoff}
      />
      <TextField
        name="fulfillmentWindowEnd"
        label="Batas pengambilan (WIB)"
        type="datetime-local"
        required
        hint="Harus pada tanggal pengambilan dan setelah batas pesan."
        defaultValue={values?.fulfillmentWindowEnd}
        errors={state.fieldErrors?.fulfillmentWindowEnd}
      />
      <button type="submit" className={PRIMARY_BUTTON_CLASS} disabled={isPending}>
        {isPending ? "Menyimpan..." : submitLabel}
      </button>
    </form>
  );
}
