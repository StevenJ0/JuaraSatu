import type { Metadata } from "next";
import Link from "next/link";
import { site } from "@/config/site";
import { PRIMARY_BUTTON_CLASS } from "@/components/form-message";
import { BackLink } from "@/components/owner/back-link";
import { Card } from "@/components/owner/card";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireBusinessOwner } from "@/features/business/guard";
import { createCapacityAction } from "@/features/capacity/actions";
import { CapacityForm } from "@/features/capacity/components/capacity-form";
import { listProducts } from "@/features/products/repository";

export const metadata: Metadata = { title: `Tambah Kapasitas — ${site.name}` };

export default async function NewCapacityPage() {
  const { businessId } = await requireBusinessOwner();
  const supabase = await createSupabaseServerClient();
  const products = await listProducts(supabase, businessId);
  const activeProducts = products
    .filter((product) => product.isActive)
    .map((product) => ({ id: product.id, name: product.name }));

  return (
    <div className="flex max-w-lg flex-col gap-4">
      <BackLink href="/dashboard/capacity" label="Kapasitas" />
      <h1 className="text-2xl font-bold text-ink">Tambah kapasitas</h1>
      <Card>
        {activeProducts.length === 0 ? (
          <div className="flex flex-col items-start gap-4">
            <p className="text-base text-muted">Belum ada produk aktif. Tambahkan produk sebelum mengatur kapasitas.</p>
            <Link href="/dashboard/products/new" className={PRIMARY_BUTTON_CLASS}>
              Tambah produk
            </Link>
          </div>
        ) : (
          <CapacityForm
            action={createCapacityAction}
            submitLabel="Simpan kapasitas"
            totalUnitsHint="Isi 0 bila tidak berproduksi pada tanggal ini."
            products={activeProducts}
          />
        )}
      </Card>
    </div>
  );
}
