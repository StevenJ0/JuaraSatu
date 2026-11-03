"use client";

import { Check } from "lucide-react";
import { useActionState, useState } from "react";
import { TextAreaField, TextField } from "@/components/form-field";
import { FormMessage, PRIMARY_BUTTON_CLASS } from "@/components/form-message";
import { Toast } from "@/components/owner/toast";
import { initialFormState, type FormState } from "@/lib/form-state";
import {
  BUSINESS_CATEGORIES,
  MAX_BUSINESS_CATEGORIES,
  OTHER_CATEGORY_LABEL,
  toCategorySelection,
} from "@/features/business/categories";

type BusinessProfileValues = {
  name: string;
  categories: string[];
  description: string;
  publicContact: string;
  pickupInstructions: string;
};

type BusinessProfileFormProps = {
  action: (previous: FormState, formData: FormData) => Promise<FormState>;
  initialValues?: BusinessProfileValues;
  submitLabel: string;
};

function CategoryChip({
  label,
  isSelected,
  isDisabled,
  onToggle,
}: {
  label: string;
  isSelected: boolean;
  isDisabled: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={isSelected}
      disabled={isDisabled}
      onClick={onToggle}
      // `text-sm!`: aturan global `button { font: inherit }` di globals.css mengalahkan utility Tailwind biasa.
      className={`inline-flex min-h-9 items-center gap-1 rounded-full border px-3 py-1 text-sm! transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        isSelected
          ? "border-brand bg-[var(--owner-highlight)] font-semibold! text-[color:var(--owner-primary-strong)]"
          : "border-line bg-surface font-medium! text-ink enabled:hover:border-brand"
      }`}
    >
      {isSelected && <Check aria-hidden size={14} strokeWidth={2} />}
      {label}
    </button>
  );
}

function CategoryField({ initialCategories, errors }: { initialCategories?: string[]; errors?: string[] }) {
  const [initial] = useState(() => toCategorySelection(initialCategories ?? []));
  const [selected, setSelected] = useState(initial.selected);
  const [isOtherSelected, setIsOtherSelected] = useState(initial.customCategory !== "");
  const [customCategory, setCustomCategory] = useState(initial.customCategory);
  // Pesan error lama bisa bertentangan dengan pilihan baru, jadi disembunyikan sampai server memberi hasil berikutnya.
  const [dismissedErrors, setDismissedErrors] = useState<string[]>();
  const visibleErrors = errors === dismissedErrors ? undefined : errors;

  const selectedCount = selected.length + (isOtherSelected ? 1 : 0);
  const isFull = selectedCount >= MAX_BUSINESS_CATEGORIES;

  function toggleCategory(category: string) {
    setDismissedErrors(errors);
    setSelected((current) =>
      current.includes(category) ? current.filter((item) => item !== category) : [...current, category],
    );
  }

  function toggleOtherCategory() {
    setDismissedErrors(errors);
    setIsOtherSelected((current) => !current);
  }

  return (
    <div className="flex flex-col gap-3">
      <div role="group" aria-labelledby="categories-label" aria-describedby="categories-hint" className="flex flex-col gap-2">
        <p id="categories-label" className="text-sm font-medium text-ink">
          Kategori
        </p>
        <div className="flex flex-wrap gap-2">
          {BUSINESS_CATEGORIES.map((category) => {
            const isSelected = selected.includes(category);
            return (
              <CategoryChip
                key={category}
                label={category}
                isSelected={isSelected}
                isDisabled={isFull && !isSelected}
                onToggle={() => toggleCategory(category)}
              />
            );
          })}
          <CategoryChip
            label={OTHER_CATEGORY_LABEL}
            isSelected={isOtherSelected}
            isDisabled={isFull && !isOtherSelected}
            onToggle={toggleOtherCategory}
          />
        </div>
        <p id="categories-hint" aria-live="polite" className="text-sm text-muted">
          Pilih 1 sampai {MAX_BUSINESS_CATEGORIES} kategori. Dipilih {selectedCount} dari {MAX_BUSINESS_CATEGORIES}.
        </p>
        {visibleErrors && visibleErrors.length > 0 && (
          <p className="text-sm text-[color:var(--owner-danger-fg)]">{visibleErrors.join(" ")}</p>
        )}
      </div>
      {selected.map((category) => (
        <input key={category} type="hidden" name="categories" value={category} />
      ))}
      {isOtherSelected && (
        <TextField
          name="customCategory"
          label="Tulis kategori usaha Anda"
          required
          maxLength={80}
          value={customCategory}
          onChange={(event) => {
            setDismissedErrors(errors);
            setCustomCategory(event.target.value);
          }}
        />
      )}
    </div>
  );
}

export function BusinessProfileForm({ action, initialValues, submitLabel }: BusinessProfileFormProps) {
  const [state, formAction, isPending] = useActionState(action, initialFormState);
  const values = state.values ?? initialValues;
  const [dismissedToastState, setDismissedToastState] = useState<FormState>();
  const showToast = state.status === "success" && state !== dismissedToastState;

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      {state.status === "error" && <FormMessage state={state} />}
      {showToast && state.message && <Toast message={state.message} onDismiss={() => setDismissedToastState(state)} />}
      <TextField
        name="name"
        label="Nama usaha"
        required
        maxLength={120}
        defaultValue={values?.name}
        errors={state.fieldErrors?.name}
      />
      <CategoryField initialCategories={initialValues?.categories} errors={state.fieldErrors?.categories} />
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
        label="Petunjuk pengambilan"
        required
        maxLength={1000}
        hint="Tampil ke pembeli. Contoh: alamat titik ambil dan jam pengambilan. Hindari detail privat."
        defaultValue={values?.pickupInstructions}
        errors={state.fieldErrors?.pickupInstructions}
      />
      <button type="submit" className={PRIMARY_BUTTON_CLASS} disabled={isPending}>
        {isPending ? "Menyimpan…" : submitLabel}
      </button>
    </form>
  );
}
