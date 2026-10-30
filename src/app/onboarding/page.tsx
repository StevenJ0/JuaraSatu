import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireUserId } from "@/features/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { findOwnedBusinessId } from "@/features/business/repository";
import { createBusinessAction } from "@/features/business/actions";
import { BusinessProfileForm } from "@/features/business/components/business-profile-form";
import { SignOutButton } from "@/features/auth/components/sign-out-button";

export const metadata: Metadata = { title: "Profil Usaha — Campaign Lab" };

export default async function OnboardingPage() {
  const userId = await requireUserId();
  const supabase = await createSupabaseServerClient();
  if (await findOwnedBusinessId(supabase, userId)) redirect("/dashboard");

  return (
    <main className="flex flex-1 justify-center bg-zinc-50 px-4 py-12 font-sans dark:bg-zinc-950">
      <div className="w-full max-w-lg">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">Lengkapi profil usaha</h1>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
              Langkah pertama sebelum menambah produk dan kapasitas produksi.
            </p>
          </div>
          <SignOutButton />
        </div>
        <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <BusinessProfileForm action={createBusinessAction} submitLabel="Simpan dan lanjutkan" />
        </div>
      </div>
    </main>
  );
}
