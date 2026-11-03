"use client";

import { useActionState } from "react";
import { FormMessage, SECONDARY_BUTTON_CLASS } from "@/components/form-message";
import { initialFormState } from "@/lib/form-state";
import { resendConfirmationAction } from "@/features/auth/actions";

export function ResendConfirmation({ email }: { email: string }) {
  const [state, formAction, isPending] = useActionState(resendConfirmationAction, initialFormState);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="email" value={email} />
      <FormMessage state={state} />
      <button type="submit" className={SECONDARY_BUTTON_CLASS} disabled={isPending}>
        {isPending ? "Mengirim…" : "Kirim ulang link"}
      </button>
    </form>
  );
}
