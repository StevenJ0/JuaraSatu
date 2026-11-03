"use client";

import Image from "next/image";
import { useActionState, useState, type ChangeEvent } from "react";
import { SelectField, TextAreaField, TextField } from "@/components/form-field";
import { FormMessage, PRIMARY_BUTTON_CLASS } from "@/components/form-message";
import { formatIdrInput } from "@/lib/format-idr";
import { initialFormState, type FormState } from "@/lib/form-state";
import { MAX_PHOTO_BYTES, PHOTO_ACCEPT, PHOTO_TOO_LARGE_MESSAGE } from "@/features/products/photo";
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
  existing?: { productId: string; version: number; photoUrl: string | null };
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
  const [photoError, setPhotoError] = useState<string | null>(null);

  // Dicek sebelum dikirim: file di atas batas body Server Action akan gagal sebelum sempat divalidasi server.
  function handlePhotoChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file && file.size > MAX_PHOTO_BYTES) {
      event.target.value = "";
      setPhotoError(PHOTO_TOO_LARGE_MESSAGE);
      return;
    }
    setPhotoError(null);
  }

  const photoErrors = photoError ? [photoError] : state.fieldErrors?.photo;

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
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
      <div className="flex flex-col gap-2">
        {existing?.photoUrl && (
          <div className="flex items-center gap-3">
            <Image
              src={existing.photoUrl}
              alt="Foto produk saat ini"
              width={64}
              height={64}
              unoptimized
              className="size-16 rounded-lg border border-line object-cover"
            />
            <label className="flex items-center gap-2 text-sm text-ink">
              <input type="checkbox" name="removePhoto" />
              Hapus foto ini
            </label>
          </div>
        )}
        <TextField
          name="photo"
          label={existing?.photoUrl ? "Ganti foto" : "Foto produk"}
          type="file"
          accept={PHOTO_ACCEPT}
          hint="JPG, PNG, atau WebP, maksimal 5MB. Foto tampil ke pembeli."
          onChange={handlePhotoChange}
          errors={photoErrors}
        />
      </div>
      <RupiahField
        name="basePrice"
        label="Harga jual per unit"
        hint="Ketik angkanya saja. Mengubah harga tidak memengaruhi order yang sudah ada."
        defaultValue={values?.basePrice}
        errors={state.fieldErrors?.basePrice}
      />
      <SelectField
        name="costQuality"
        label="Status biaya variabel"
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
          label="Biaya variabel per unit"
          hint="Biaya bahan, produksi, dan kemasan per unit. Isi 0 hanya bila memang tanpa biaya."
          defaultValue={values?.variableCost}
          errors={state.fieldErrors?.variableCost}
        />
      )}
      <button type="submit" className={PRIMARY_BUTTON_CLASS} disabled={isPending}>
        {isPending ? "Menyimpan..." : submitLabel}
      </button>
    </form>
  );
}
