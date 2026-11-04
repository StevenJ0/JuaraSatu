import type { Metadata } from "next";
import { site } from "@/config/site";
import { SignUpForm } from "@/features/auth/components/sign-up-form";

export const metadata: Metadata = { title: `Daftar | ${site.name}` };

export default function RegisterPage() {
  return (
    <>
      <h1 className="mb-1 text-2xl font-bold text-ink">Daftar</h1>
      <p className="mb-6 text-base text-muted">
        Buat akun pemilik usaha. Tidak perlu data rekening atau akun payment gateway.
      </p>
      <SignUpForm />
    </>
  );
}
