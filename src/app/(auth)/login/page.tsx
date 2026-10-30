import type { Metadata } from "next";
import { site } from "@/config/site";
import { SignInForm } from "@/features/auth/components/sign-in-form";

export const metadata: Metadata = { title: `Masuk — ${site.name}` };

const NOTICES: Record<string, string> = {
  confirm_failed: "Link konfirmasi tidak valid atau sudah kedaluwarsa. Silakan masuk atau daftar ulang.",
};

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { error } = await searchParams;
  const notice = typeof error === "string" ? NOTICES[error] : undefined;

  return (
    <>
      <h1 className="mb-1 text-xl font-semibold text-ink">Masuk</h1>
      <p className="mb-6 text-sm text-muted">Kelola usaha dan preorder Anda.</p>
      <SignInForm notice={notice} />
    </>
  );
}
