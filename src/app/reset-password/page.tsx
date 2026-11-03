import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { site } from "@/config/site";
import { RECOVERY_FAILED_URL } from "@/features/auth/confirm-redirect";
import { AuthShell } from "@/features/auth/components/auth-shell";
import { ResetPasswordForm } from "@/features/auth/components/reset-password-form";
import { getCurrentUserId } from "@/features/auth/session";

export const metadata: Metadata = { title: `Password Baru — ${site.name}` };

// Di luar grup (auth): link reset memberi session, sedangkan layout grup itu mengalihkan user ber-session ke dashboard.
export default async function ResetPasswordPage() {
  if (!(await getCurrentUserId())) redirect(RECOVERY_FAILED_URL);

  return (
    <AuthShell>
      <h1 className="mb-1 text-xl font-semibold text-ink">Buat password baru</h1>
      <p className="mb-6 text-sm text-muted">Setelah disimpan, Anda diminta masuk lagi dengan password baru.</p>
      <ResetPasswordForm />
    </AuthShell>
  );
}
