import type { Metadata } from "next";
import { site } from "@/config/site";
import { Card } from "@/components/owner/card";
import { getCurrentBusinessProfile } from "@/features/business/guard";
import { updateBusinessAction } from "@/features/business/actions";
import { BusinessProfileForm } from "@/features/business/components/business-profile-form";

export const metadata: Metadata = { title: `Profil Usaha | ${site.name}` };

export default async function BusinessProfilePage() {
  const business = await getCurrentBusinessProfile();

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-ink">Profil usaha</h1>
        <p className="mt-1 text-base text-muted">
          Nama, kontak publik, dan petunjuk pengambilan dapat tampil di halaman kampanye publik.
        </p>
      </div>
      <Card>
        <BusinessProfileForm
          action={updateBusinessAction}
          submitLabel="Simpan perubahan"
          initialValues={{
            name: business.name,
            categories: business.categories,
            description: business.description ?? "",
            publicContact: business.publicContact ?? "",
            pickupInstructions: business.pickupInstructions,
          }}
        />
      </Card>
    </div>
  );
}
