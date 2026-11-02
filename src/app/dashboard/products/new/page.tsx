import type { Metadata } from "next";
import { site } from "@/config/site";
import { requireBusinessOwner } from "@/features/business/guard";
import { createProductAction } from "@/features/products/actions";
import { ProductForm } from "@/features/products/components/product-form";

export const metadata: Metadata = { title: `Tambah Produk — ${site.name}` };

export default async function NewProductPage() {
  await requireBusinessOwner();

  return (
    <div className="flex max-w-lg flex-col gap-6">
      <h1 className="text-2xl font-bold text-ink">Tambah produk</h1>
      <div className="rounded-2xl border border-line bg-surface p-6">
        <ProductForm action={createProductAction} submitLabel="Simpan produk" />
      </div>
    </div>
  );
}
