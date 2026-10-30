import type { Metadata } from "next";
import { SignInForm } from "@/features/auth/components/sign-in-form";

export const metadata: Metadata = { title: "Masuk — Campaign Lab" };

const NOTICES: Record<string, string> = {
  confirm_failed: "Link konfirmasi tidak valid atau sudah kedaluwarsa. Silakan masuk atau daftar ulang.",
};

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { error } = await searchParams;
  const notice = typeof error === "string" ? NOTICES[error] : undefined;

  return (
    <>
      <h1 className="mb-1 text-xl font-semibold text-zinc-900 dark:text-zinc-50">Masuk</h1>
      <p className="mb-6 text-sm text-zinc-600 dark:text-zinc-400">Kelola usaha dan preorder Anda.</p>
      <SignInForm notice={notice} />
    </>
  );
}
