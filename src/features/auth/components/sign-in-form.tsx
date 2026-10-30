"use client";

import Link from "next/link";
import { useActionState } from "react";
import { TextField } from "@/components/form-field";
import { FormMessage, PRIMARY_BUTTON_CLASS } from "@/components/form-message";
import { initialFormState } from "@/lib/form-state";
import { signInAction } from "@/features/auth/actions";

export function SignInForm({ notice }: { notice?: string }) {
  const [state, formAction, isPending] = useActionState(signInAction, initialFormState);

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      {notice && state.status === "idle" && <FormMessage state={{ status: "error", message: notice }} />}
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
        autoComplete="current-password"
        required
        errors={state.fieldErrors?.password}
      />
      <button type="submit" className={PRIMARY_BUTTON_CLASS} disabled={isPending}>
        {isPending ? "Memproses..." : "Masuk"}
      </button>
      <p className="text-center text-sm text-zinc-600 dark:text-zinc-400">
        Belum punya akun?{" "}
        <Link href="/register" className="font-medium text-amber-700 hover:underline dark:text-amber-500">
          Daftar
        </Link>
      </p>
    </form>
  );
}
