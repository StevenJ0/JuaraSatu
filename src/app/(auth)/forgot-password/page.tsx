import type { Metadata } from "next";
import { site } from "@/config/site";
import type { FormState } from "@/lib/form-state";
import { ForgotPasswordForm } from "@/features/auth/components/forgot-password-form";

export const metadata: Metadata = { title: `Lupa Password | ${site.name}` };

const NOTICES = new Map<unknown, FormState>([
  [
    "recovery_failed",
    {
      status: "error",
      message: "Link tidak valid, sudah dipakai, atau kedaluwarsa. Minta link baru di bawah ini.",
    },
  ],
]);

export default async function ForgotPasswordPage({ searchParams }: PageProps<"/forgot-password">) {
  const { notice } = await searchParams;

  return (
    <>
      <h1 className="mb-1 text-2xl font-bold text-ink">Lupa password</h1>
      <p className="mb-6 text-base text-muted">Masukkan email akun Anda. Kami kirim link untuk membuat password baru.</p>
      <ForgotPasswordForm notice={NOTICES.get(notice)} />
    </>
  );
}
