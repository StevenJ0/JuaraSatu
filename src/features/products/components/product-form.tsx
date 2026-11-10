"use client";

import { useActionState, useState } from "react";
import { SelectField, TextAreaField, TextField } from "@/components/form-field";
import { FormMessage, PRIMARY_BUTTON_CLASS } from "@/components/form-message";
import { formatIdrInput } from "@/lib/format-idr";
import { initialFormState, type FormState } from "@/lib/form-state";
import { submitWithoutReset } from "@/lib/submit-without-reset";
import { ProductPhotoPicker, type ExistingPhoto } from "@/features/products/components/product-photo-picker";
import { COST_QUALITIES, COST_QUALITY_LABELS } from "@/features/products/schemas";

type ProductFormValues = {
  name: string;
  description: string;
  basePrice: string;
  costQuality: string;
  variableCost: string;
};

type ProductFormProps = {
  action: (previous: FormState, formData: FormData) => Promise<FormState>;
  submitLabel: string;
  initialValues?: ProductFormValues;
  /** Diisi saat mengubah produk yang sudah ada. */
  existing?: { productId: string; version: number; photos: ExistingPhoto[] };
};

function RupiahField({
  name,
  label,
  hint,
  defaultValue,
  errors,
}: {
  name: string;
  label: string;
  hint: string;
  defaultValue?: string;
  errors?: string[];
}) {
  const [amount, setAmount] = useState(formatIdrInput(defaultValue ?? ""));

  return (
    <TextField
      name={name}
      label={label}
      required
      inputMode="numeric"
      autoComplete="off"
      placeholder="Rp0"
      hint={hint}
      value={amount}
      onChange={(event) => setAmount(formatIdrInput(event.target.value))}
      errors={errors}
    />
  );
}

export function ProductForm({ action, submitLabel, initialValues, existing }: ProductFormProps) {
  const [state, formAction, isPending] = useActionState(action, initialFormState);
  const values = state.values ?? initialValues;
  const [costQuality, setCostQuality] = useState(values?.costQuality ?? "unknown");

  return (
    <form action={formAction} onSubmit={submitWithoutReset(formAction)} className="flex flex-col gap-4" noValidate>
      <FormMessage state={state} />
      {existing && (
        <>
          <input type="hidden" name="productId" value={existing.productId} />
          <input type="hidden" name="version" value={existing.version} />
        </>
      )}
      <TextField
        name="name"
        label="Nama produk"
        required
        maxLength={160}
        defaultValue={values?.name}
        errors={state.fieldErrors?.name}
      />
      <TextAreaField
        name="description"
        label="Deskripsi"
        maxLength={1000}
        defaultValue={values?.description}
        errors={state.fieldErrors?.description}
      />
      <ProductPhotoPicker existingPhotos={existing?.photos ?? []} serverErrors={state.fieldErrors?.photo} />
      <RupiahField
        name="basePrice"
        label="Harga jual per unit"
        hint="Ketik angkanya saja. Mengubah harga tidak memengaruhi order yang sudah ada."
        defaultValue={values?.basePrice}
        errors={state.fieldErrors?.basePrice}
      />
      <SelectField
        name="costQuality"
        label="Status modal"
        value={costQuality}
        onChange={(event) => setCostQuality(event.target.value)}
        errors={state.fieldErrors?.costQuality}
      >
        {COST_QUALITIES.map((quality) => (
          <option key={quality} value={quality}>
            {COST_QUALITY_LABELS[quality]}
          </option>
        ))}
      </SelectField>
      {costQuality !== "unknown" && (
        <RupiahField
          name="variableCost"
          label="Modal per unit"
          hint="Modal bahan, produksi, dan kemasan untuk membuat satu unit. Isi 0 hanya bila memang tanpa modal."
          defaultValue={values?.variableCost}
          errors={state.fieldErrors?.variableCost}
        />
      )}
      <button type="submit" className={PRIMARY_BUTTON_CLASS} disabled={isPending}>
        {isPending ? "Menyimpan…" : submitLabel}
      </button>
    </form>
  );
}
