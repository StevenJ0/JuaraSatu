import type { Metadata } from "next";
import Link from "next/link";
import { site } from "@/config/site";
import { PRIMARY_BUTTON_CLASS } from "@/components/form-message";
import { BackLink } from "@/components/owner/back-link";
import { Card } from "@/components/owner/card";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireBusinessOwner } from "@/features/business/guard";
import { createPreorderAction } from "@/features/preorders/actions";
import { listPreorderCapacityOptions } from "@/features/preorders/capacity-options";
import { PreorderForm } from "@/features/preorders/components/preorder-form";

export const metadata: Metadata = { title: `Buat Preorder | ${site.name}` };

export default async function NewPreorderPage() {
  const { businessId } = await requireBusinessOwner();
  const supabase = await createSupabaseServerClient();
  const capacityOptions = await listPreorderCapacityOptions(supabase, businessId);

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-4">
      <BackLink href="/dashboard/preorders" label="Preorder" />
      <h1 className="text-2xl font-bold text-ink">Buat preorder</h1>
      <Card>
        {capacityOptions.length === 0 ? (
          <div className="flex flex-col items-start gap-4">
            <p className="text-base text-muted">
              Belum ada jadwal produksi yang bisa dipakai. Tambahkan kapasitas untuk produk aktif dengan batas pesan yang belum lewat.
            </p>
            <Link href="/dashboard/capacity/new" className={PRIMARY_BUTTON_CLASS}>
              Tambah kapasitas
            </Link>
          </div>
        ) : (
          <PreorderForm action={createPreorderAction} submitLabel="Simpan draf" capacityOptions={capacityOptions} />
        )}
      </Card>
    </div>
  );
}
