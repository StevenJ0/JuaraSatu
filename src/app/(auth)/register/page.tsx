import type { Metadata } from "next";
import { SignUpForm } from "@/features/auth/components/sign-up-form";

export const metadata: Metadata = { title: "Daftar — Campaign Lab" };

export default function RegisterPage() {
  return (
    <>
      <h1 className="mb-1 text-xl font-semibold text-zinc-900 dark:text-zinc-50">Daftar</h1>
      <p className="mb-6 text-sm text-zinc-600 dark:text-zinc-400">
        Buat akun pemilik usaha. Tidak perlu data rekening atau akun payment gateway.
      </p>
      <SignUpForm />
    </>
  );
}
