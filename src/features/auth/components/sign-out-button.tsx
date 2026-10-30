import { signOutAction } from "@/features/auth/actions";

export function SignOutButton() {
  return (
    <form action={signOutAction}>
      <button
        type="submit"
        className="rounded-lg px-3 py-1.5 text-sm! font-medium! text-muted transition hover:bg-subtle hover:text-ink"
      >
        Keluar
      </button>
    </form>
  );
}
