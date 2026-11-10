import type { Metadata } from "next";
import { site } from "@/config/site";
import { BackLink } from "@/components/owner/back-link";
import { Card } from "@/components/owner/card";
import { requireBusinessOwner } from "@/features/business/guard";
import { createProductAction } from "@/features/products/actions";
import { ProductForm } from "@/features/products/components/product-form";

export const metadata: Metadata = { title: `Tambah Produk | ${site.name}` };

export default async function NewProductPage() {
  await requireBusinessOwner();

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-4">
      <BackLink href="/dashboard/products" label="Produk" />
      <h1 className="text-2xl font-bold text-ink">Tambah produk</h1>
      <Card>
        <ProductForm action={createProductAction} submitLabel="Simpan produk" />
      </Card>
    </div>
  );
}
