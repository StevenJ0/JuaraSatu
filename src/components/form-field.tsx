import type { InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from "react";

const CONTROL_CLASS =
  "w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20 aria-[invalid=true]:border-red-500";

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
        <p id={`${name}-hint`} className="text-xs text-muted">
          {hint}
        </p>
      )}
      {errors && errors.length > 0 && (
        <p id={`${name}-error`} className="text-xs text-red-600">
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

type TextAreaFieldProps = FieldBaseProps & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "name" | "id">;

export function TextAreaField({ name, label, errors, hint, ...textareaProps }: TextAreaFieldProps) {
  const field = { name, label, errors, hint };
  return (
    <FieldShell {...field}>
      <textarea rows={3} {...textareaProps} {...controlProps(field)} />
    </FieldShell>
  );
}
