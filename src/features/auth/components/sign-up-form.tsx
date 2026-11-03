"use client";

import Link from "next/link";
import { useActionState } from "react";
import { TextField } from "@/components/form-field";
import { FormMessage, PRIMARY_BUTTON_CLASS, TEXT_LINK_CLASS } from "@/components/form-message";
import { initialFormState } from "@/lib/form-state";
import { signUpAction } from "@/features/auth/actions";
import { ResendConfirmation } from "@/features/auth/components/resend-confirmation";

export function SignUpForm() {
  const [state, formAction, isPending] = useActionState(signUpAction, initialFormState);

  if (state.status === "success") {
    return (
      <div className="flex flex-col gap-4">
        <FormMessage state={state} />
        <Link href="/login" className={PRIMARY_BUTTON_CLASS}>
          Buka halaman masuk
        </Link>
        {state.values?.email && <ResendConfirmation email={state.values.email} />}
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      <FormMessage state={state} />
      <TextField
        name="email"
        label="Email"
        type="email"
        autoComplete="email"
        required
        defaultValue={state.values?.email}
        errors={state.fieldErrors?.email}
      />
      <TextField
        name="password"
        label="Password"
        type="password"
        autoComplete="new-password"
        required
        hint="Minimal 8 karakter."
        errors={state.fieldErrors?.password}
      />
      <TextField
        name="confirmPassword"
        label="Ulangi password"
        type="password"
        autoComplete="new-password"
        required
        errors={state.fieldErrors?.confirmPassword}
      />
      <button type="submit" className={PRIMARY_BUTTON_CLASS} disabled={isPending}>
        {isPending ? "Memproses…" : "Daftar"}
      </button>
      <p className="text-center text-base text-muted">
        Sudah punya akun?{" "}
        <Link href="/login" className={TEXT_LINK_CLASS}>
          Masuk
        </Link>
      </p>
    </form>
  );
}
