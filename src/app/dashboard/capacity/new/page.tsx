import type { Metadata } from "next";
import Link from "next/link";
import { site } from "@/config/site";
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
    <div className="flex max-w-lg flex-col gap-6">
      <h1 className="text-2xl font-bold text-ink">Tambah kapasitas</h1>
      <div className="rounded-2xl border border-line bg-surface p-6">
        {activeProducts.length === 0 ? (
          <p className="text-sm text-muted">
            Belum ada produk aktif.{" "}
            <Link href="/dashboard/products/new" className="font-medium text-brand hover:underline">
              Tambah produk dulu
            </Link>
            .
          </p>
        ) : (
          <CapacityForm
            action={createCapacityAction}
            submitLabel="Simpan kapasitas"
            totalUnitsHint="Isi 0 bila tidak berproduksi pada tanggal ini."
            products={activeProducts}
          />
        )}
      </div>
    </div>
  );
}
