import type { FormState } from "@/lib/form-state";

export function FormMessage({ state }: { state: FormState }) {
  if (!state.message) return null;
  const isError = state.status === "error";
  return (
    <p
      role={isError ? "alert" : "status"}
      className={
        isError
          ? "rounded-[10px] bg-[var(--owner-danger-bg)] px-3 py-2 text-base text-[color:var(--owner-danger-fg)]"
          : "rounded-[10px] bg-[var(--owner-success-bg)] px-3 py-2 text-base text-[color:var(--owner-success-fg)]"
      }
    >
      {state.message}
    </p>
  );
}

// `!` diperlukan karena globals.css (`button { font: inherit }`, di luar layer) mengalahkan utility ukuran/ketebalan font.
export const PRIMARY_BUTTON_CLASS =
  "inline-flex min-h-12 items-center justify-center rounded-[10px] bg-brand px-5 py-3 text-base! font-semibold! text-on-brand transition-colors duration-150 hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-60";

export const SECONDARY_BUTTON_CLASS =
  "inline-flex min-h-12 items-center justify-center rounded-[10px] border border-line bg-surface px-5 py-3 text-base! font-semibold! text-ink transition-colors duration-150 hover:bg-subtle disabled:cursor-not-allowed disabled:opacity-60";

export const TEXT_LINK_CLASS =
  "font-semibold text-brand underline decoration-line underline-offset-4 hover:decoration-current";
