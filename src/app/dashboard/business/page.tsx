import type { Metadata } from "next";
import { getCurrentBusinessProfile } from "@/features/business/guard";
import { updateBusinessAction } from "@/features/business/actions";
import { BusinessProfileForm } from "@/features/business/components/business-profile-form";

export const metadata: Metadata = { title: "Profil Usaha — Campaign Lab" };

export default async function BusinessProfilePage() {
  const business = await getCurrentBusinessProfile();

  return (
    <div className="flex max-w-lg flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">Profil usaha</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Nama, kontak publik, dan petunjuk pickup dapat tampil di halaman kampanye publik.
        </p>
      </div>
      <div className="rounded-2xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
        <BusinessProfileForm
          action={updateBusinessAction}
          submitLabel="Simpan perubahan"
          initialValues={{
            name: business.name,
            category: business.category,
            description: business.description ?? "",
            publicContact: business.publicContact ?? "",
            pickupInstructions: business.pickupInstructions ?? "",
          }}
        />
      </div>
    </div>
  );
}
