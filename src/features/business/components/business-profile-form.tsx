"use client";

import { useActionState } from "react";
import { TextAreaField, TextField } from "@/components/form-field";
import { FormMessage, PRIMARY_BUTTON_CLASS } from "@/components/form-message";
import { initialFormState, type FormState } from "@/lib/form-state";

type BusinessProfileValues = {
  name: string;
  category: string;
  description: string;
  publicContact: string;
  pickupInstructions: string;
};

type BusinessProfileFormProps = {
  action: (previous: FormState, formData: FormData) => Promise<FormState>;
  initialValues?: BusinessProfileValues;
  submitLabel: string;
};

const CATEGORY_SUGGESTIONS = ["bakery", "kue basah", "katering", "makanan rumahan", "minuman", "camilan"];

export function BusinessProfileForm({ action, initialValues, submitLabel }: BusinessProfileFormProps) {
  const [state, formAction, isPending] = useActionState(action, initialFormState);
  const values = state.values ?? initialValues;

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      <FormMessage state={state} />
      <TextField
        name="name"
        label="Nama usaha"
        required
        maxLength={120}
        defaultValue={values?.name}
        errors={state.fieldErrors?.name}
      />
      <TextField
        name="category"
        label="Kategori"
        required
        maxLength={80}
        list="business-category-suggestions"
        hint="Contoh: bakery, katering, kue basah."
        defaultValue={values?.category}
        errors={state.fieldErrors?.category}
      />
      <datalist id="business-category-suggestions">
        {CATEGORY_SUGGESTIONS.map((category) => (
          <option key={category} value={category} />
        ))}
      </datalist>
      <TextAreaField
        name="description"
        label="Deskripsi singkat"
        maxLength={1000}
        defaultValue={values?.description}
        errors={state.fieldErrors?.description}
      />
      <TextField
        name="publicContact"
        label="Kontak publik"
        maxLength={120}
        hint="Akan tampil di halaman kampanye publik. Contoh: WhatsApp 0812-xxxx atau @instagram."
        defaultValue={values?.publicContact}
        errors={state.fieldErrors?.publicContact}
      />
      <TextAreaField
        name="pickupInstructions"
        label="Petunjuk pengambilan (pickup)"
        maxLength={1000}
        hint="Hindari detail privat yang tidak perlu ditampilkan ke pelanggan."
        defaultValue={values?.pickupInstructions}
        errors={state.fieldErrors?.pickupInstructions}
      />
      <button type="submit" className={PRIMARY_BUTTON_CLASS} disabled={isPending}>
        {isPending ? "Menyimpan..." : submitLabel}
      </button>
    </form>
  );
}
