import type { FormState } from "@/lib/form-state";

export function FormMessage({ state }: { state: FormState }) {
  if (!state.message) return null;
  const isError = state.status === "error";
  return (
    <p
      role={isError ? "alert" : "status"}
      className={
        isError
          ? "rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"
          : "rounded-lg bg-[var(--ui-brand-soft)] px-3 py-2 text-sm text-brand"
      }
    >
      {state.message}
    </p>
  );
}

// `!` diperlukan karena globals.css (`button { font: inherit }`, di luar layer) mengalahkan utility ukuran/ketebalan font.
export const PRIMARY_BUTTON_CLASS =
  "inline-flex min-h-12 items-center justify-center rounded-lg bg-brand px-5 py-3 text-sm! font-semibold! text-on-brand transition-colors duration-150 hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-60";
