import type { Metadata } from "next";
import { site } from "@/config/site";
import { redirect } from "next/navigation";
import { requireUserId } from "@/features/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { findOwnedBusinessId } from "@/features/business/repository";
import { createBusinessAction } from "@/features/business/actions";
import { BusinessProfileForm } from "@/features/business/components/business-profile-form";
import { SignOutButton } from "@/features/auth/components/sign-out-button";

export const metadata: Metadata = { title: `Profil Usaha — ${site.name}` };

export default async function OnboardingPage() {
  const userId = await requireUserId();
  const supabase = await createSupabaseServerClient();
  if (await findOwnedBusinessId(supabase, userId)) redirect("/dashboard");

  return (
    <main className="flex min-h-screen justify-center bg-background px-4 py-12 font-sans">
      <div className="w-full max-w-lg">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-ink">Lengkapi profil usaha</h1>
            <p className="mt-1 text-sm text-muted">
              Langkah pertama sebelum menambah produk dan kapasitas produksi.
            </p>
          </div>
          <SignOutButton />
        </div>
        <div className="rounded-2xl border border-line bg-surface p-6">
          <BusinessProfileForm action={createBusinessAction} submitLabel="Simpan dan lanjutkan" />
        </div>
      </div>
    </main>
  );
}
