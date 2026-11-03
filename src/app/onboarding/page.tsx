import type { Metadata } from "next";
import { site } from "@/config/site";
import { redirect } from "next/navigation";
import { Card } from "@/components/owner/card";
import { OwnerTheme } from "@/components/owner/owner-theme";
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
    <OwnerTheme>
      <main className="flex min-h-screen justify-center px-4 py-8 sm:py-12">
        <div className="w-full max-w-lg">
          <div className="mb-6 flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-ink">Lengkapi profil usaha</h1>
              <p className="mt-1 text-base text-muted">
                Langkah pertama sebelum menambah produk dan kapasitas produksi.
              </p>
            </div>
            <SignOutButton />
          </div>
          <Card>
            <BusinessProfileForm action={createBusinessAction} submitLabel="Simpan dan lanjutkan" />
          </Card>
        </div>
      </main>
    </OwnerTheme>
  );
}
