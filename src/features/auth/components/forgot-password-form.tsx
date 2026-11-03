"use client";

import Link from "next/link";
import { useActionState } from "react";
import { TextField } from "@/components/form-field";
import { FormMessage, PRIMARY_BUTTON_CLASS, TEXT_LINK_CLASS } from "@/components/form-message";
import { initialFormState, type FormState } from "@/lib/form-state";
import { requestPasswordResetAction } from "@/features/auth/actions";

export function ForgotPasswordForm({ notice }: { notice?: FormState }) {
  const [state, formAction, isPending] = useActionState(requestPasswordResetAction, initialFormState);

  if (state.status === "success") {
    return (
      <div className="flex flex-col gap-4">
        <FormMessage state={state} />
        <Link href="/login" className={PRIMARY_BUTTON_CLASS}>
          Buka halaman masuk
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      {notice && state.status === "idle" && <FormMessage state={notice} />}
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
      <button type="submit" className={PRIMARY_BUTTON_CLASS} disabled={isPending}>
        {isPending ? "Memproses…" : "Kirim link"}
      </button>
      <p className="text-center text-base text-muted">
        Ingat password Anda?{" "}
        <Link href="/login" className={TEXT_LINK_CLASS}>
          Masuk
        </Link>
      </p>
    </form>
  );
}
