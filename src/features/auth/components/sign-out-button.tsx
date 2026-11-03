import { LogOut } from "lucide-react";
import { signOutAction } from "@/features/auth/actions";

export function SignOutButton() {
  return (
    <form action={signOutAction}>
      <button
        type="submit"
        className="inline-flex min-h-11 items-center gap-2 rounded-[10px] px-3 py-1.5 text-sm! font-medium! text-muted transition-colors hover:bg-subtle hover:text-ink"
      >
        <LogOut aria-hidden size={18} strokeWidth={1.5} />
        Keluar
      </button>
    </form>
  );
}
