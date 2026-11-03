"use client";

import Link from "next/link";
import { useActionState } from "react";
import { TextField } from "@/components/form-field";
import { FormMessage, PRIMARY_BUTTON_CLASS, TEXT_LINK_CLASS } from "@/components/form-message";
import { initialFormState, type FormState } from "@/lib/form-state";
import { signInAction } from "@/features/auth/actions";
import { ResendConfirmation } from "@/features/auth/components/resend-confirmation";

export function SignInForm({ notice }: { notice?: FormState }) {
  const [state, formAction, isPending] = useActionState(signInAction, initialFormState);
  const unverifiedEmail = state.code === "email_not_confirmed" ? state.values?.email : undefined;

  return (
    <div className="flex flex-col gap-4">
      {notice && state.status === "idle" && <FormMessage state={notice} />}
      <FormMessage state={state} />
      {unverifiedEmail && <ResendConfirmation key={unverifiedEmail} email={unverifiedEmail} />}
      <form action={formAction} className="flex flex-col gap-4" noValidate>
        <TextField
          name="email"
          label="Email"
          type="email"
          autoComplete="email"
          required
          defaultValue={state.values?.email}
          errors={state.fieldErrors?.email}
        />
        <div className="flex flex-col gap-1.5">
          <TextField
            name="password"
            label="Password"
            type="password"
            autoComplete="current-password"
            required
            errors={state.fieldErrors?.password}
          />
          <Link href="/forgot-password" className={`self-end text-sm ${TEXT_LINK_CLASS}`}>
            Lupa password?
          </Link>
        </div>
        <button type="submit" className={PRIMARY_BUTTON_CLASS} disabled={isPending}>
          {isPending ? "Memproses…" : "Masuk"}
        </button>
        <p className="text-center text-base text-muted">
          Belum punya akun?{" "}
          <Link href="/register" className={TEXT_LINK_CLASS}>
            Daftar
          </Link>
        </p>
      </form>
    </div>
  );
}
