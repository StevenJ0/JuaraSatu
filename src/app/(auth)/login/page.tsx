import type { Metadata } from "next";
import { site } from "@/config/site";
import type { FormState } from "@/lib/form-state";
import { SignInForm } from "@/features/auth/components/sign-in-form";

export const metadata: Metadata = { title: `Masuk | ${site.name}` };

const NOTICES = new Map<unknown, FormState>([
  [
    "confirm_failed",
    {
      status: "error",
      message:
        "Link verifikasi tidak valid, sudah dipakai, atau kedaluwarsa. Coba masuk. Jika email belum terverifikasi, Anda bisa meminta link baru.",
    },
  ],
  ["password_updated", { status: "success", message: "Password berhasil diubah. Silakan masuk dengan password baru." }],
]);

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { notice } = await searchParams;

  return (
    <>
      <h1 className="mb-1 text-2xl font-bold text-ink">Masuk</h1>
      <p className="mb-6 text-base text-muted">Kelola usaha dan preorder Anda.</p>
      <SignInForm notice={NOTICES.get(notice)} />
    </>
  );
}
