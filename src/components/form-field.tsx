"use client";

import { useEffect, useRef, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";

// 16px di layar kecil agar iOS tidak auto-zoom saat fokus; `!` karena `input { font: inherit }` di globals.css mengalahkan utility biasa.
const CONTROL_CLASS =
  "min-h-11 w-full rounded-md border border-line bg-surface px-3 py-2 text-[16px]! text-ink transition sm:text-[15px]! file:mr-3 file:rounded-md file:border-0 file:bg-subtle file:px-3 file:py-1 file:text-sm file:font-medium file:text-ink focus:border-brand aria-[invalid=true]:border-[var(--owner-danger-fg)]";

type FieldBaseProps = {
  name: string;
  label: string;
  errors?: string[];
  hint?: string;
};

function controlProps({ name, errors, hint }: FieldBaseProps) {
  const describedBy = [errors?.length ? `${name}-error` : null, hint ? `${name}-hint` : null]
    .filter(Boolean)
    .join(" ");
  return {
    id: name,
    name,
    className: CONTROL_CLASS,
    "aria-invalid": errors?.length ? true : undefined,
    "aria-describedby": describedBy || undefined,
  };
}

function FieldShell({ name, label, errors, hint, children }: FieldBaseProps & { children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={name} className="text-sm font-medium text-ink">
        {label}
      </label>
      {children}
      {hint && (
        <p id={`${name}-hint`} className="text-sm text-muted">
          {hint}
        </p>
      )}
      {errors && errors.length > 0 && (
        <p id={`${name}-error`} className="text-sm text-[color:var(--owner-danger-fg)]">
          {errors.join(" ")}
        </p>
      )}
    </div>
  );
}

type TextFieldProps = FieldBaseProps & Omit<InputHTMLAttributes<HTMLInputElement>, "name" | "id">;

export function TextField({ name, label, errors, hint, ...inputProps }: TextFieldProps) {
  const field = { name, label, errors, hint };
  return (
    <FieldShell {...field}>
      <input {...inputProps} {...controlProps(field)} />
    </FieldShell>
  );
}

type SelectFieldProps = FieldBaseProps & Omit<SelectHTMLAttributes<HTMLSelectElement>, "name" | "id">;

export function SelectField({ name, label, errors, hint, children, ...selectProps }: SelectFieldProps) {
  const field = { name, label, errors, hint };
  const selectRef = useRef<HTMLSelectElement>(null);
  const { value } = selectProps;

  // React mereset form setelah action selesai, dan reset mengembalikan select ke opsi `defaultSelected`.
  // Select terkontrol tidak punya default itu, sehingga tanpa ini tampil dan terkirim sebagai opsi pertama.
  useEffect(() => {
    if (value === undefined || !selectRef.current) return;
    for (const option of Array.from(selectRef.current.options)) {
      option.defaultSelected = option.value === String(value);
    }
  }, [value]);

  return (
    <FieldShell {...field}>
      <select {...selectProps} {...controlProps(field)} ref={selectRef}>
        {children}
      </select>
    </FieldShell>
  );
}

type TextAreaFieldProps = FieldBaseProps & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "name" | "id">;

export function TextAreaField({ name, label, errors, hint, ...textareaProps }: TextAreaFieldProps) {
  const field = { name, label, errors, hint };
  return (
    <FieldShell {...field}>
      <textarea rows={3} {...textareaProps} {...controlProps(field)} />
    </FieldShell>
  );
}
