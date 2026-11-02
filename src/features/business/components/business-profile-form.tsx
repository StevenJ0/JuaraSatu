"use client";

import { useActionState, useState } from "react";
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

const CATEGORY_SUGGESTIONS = ["Bakery", "Kue basah", "Katering", "Makanan rumahan", "Minuman", "Camilan"];

function CategoryField({ defaultValue, errors }: { defaultValue?: string; errors?: string[] }) {
  const [category, setCategory] = useState(defaultValue ?? "");

  return (
    <div className="flex flex-col gap-2">
      <TextField
        name="category"
        label="Kategori"
        required
        maxLength={80}
        hint="Pilih salah satu atau tulis sendiri."
        value={category}
        onChange={(event) => setCategory(event.target.value)}
        errors={errors}
      />
      <div role="group" aria-label="Pilihan kategori" className="flex flex-wrap gap-2">
        {CATEGORY_SUGGESTIONS.map((suggestion) => {
          const isSelected = category.trim().toLowerCase() === suggestion.toLowerCase();
          return (
            <button
              key={suggestion}
              type="button"
              aria-pressed={isSelected}
              onClick={() => setCategory(isSelected ? "" : suggestion)}
              // `text-xs!`: aturan global `button { font: inherit }` di globals.css mengalahkan utility Tailwind biasa.
              className={`rounded-full border px-3 py-1.5 text-xs! transition outline-none focus-visible:ring-2 focus-visible:ring-brand/40 ${
                isSelected
                  ? "border-brand bg-brand text-on-brand"
                  : "border-line bg-surface text-ink hover:border-brand hover:text-brand"
              }`}
            >
              {suggestion}
            </button>
          );
        })}
      </div>
    </div>
  );
}

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
      <CategoryField defaultValue={values?.category} errors={state.fieldErrors?.category} />
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
        required
        maxLength={1000}
        hint="Tampil ke pembeli. Contoh: alamat titik ambil dan jam pengambilan. Hindari detail privat."
        defaultValue={values?.pickupInstructions}
        errors={state.fieldErrors?.pickupInstructions}
      />
      <button type="submit" className={PRIMARY_BUTTON_CLASS} disabled={isPending}>
        {isPending ? "Menyimpan..." : submitLabel}
      </button>
    </form>
  );
}
