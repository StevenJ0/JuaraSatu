"use client";

import { useActionState } from "react";
import { TextField } from "@/components/form-field";
import { FormMessage, PRIMARY_BUTTON_CLASS } from "@/components/form-message";
import { initialFormState } from "@/lib/form-state";
import { updatePasswordAction } from "@/features/auth/actions";

export function ResetPasswordForm() {
  const [state, formAction, isPending] = useActionState(updatePasswordAction, initialFormState);

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      <FormMessage state={state} />
      <TextField
        name="password"
        label="Password baru"
        type="password"
        autoComplete="new-password"
        required
        hint="Minimal 8 karakter."
        errors={state.fieldErrors?.password}
      />
      <TextField
        name="confirmPassword"
        label="Ulangi password baru"
        type="password"
        autoComplete="new-password"
        required
        errors={state.fieldErrors?.confirmPassword}
      />
      <button type="submit" className={PRIMARY_BUTTON_CLASS} disabled={isPending}>
        {isPending ? "Menyimpan…" : "Simpan password baru"}
      </button>
    </form>
  );
}
