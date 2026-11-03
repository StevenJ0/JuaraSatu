import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { site } from "@/config/site";
import { BackLink } from "@/components/owner/back-link";
import { Card } from "@/components/owner/card";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireBusinessOwner } from "@/features/business/guard";
import { updateProductAction } from "@/features/products/actions";
import { ProductForm } from "@/features/products/components/product-form";
import { findProduct } from "@/features/products/repository";

export const metadata: Metadata = { title: `Ubah Produk — ${site.name}` };

export default async function EditProductPage({ params }: PageProps<"/dashboard/products/[id]">) {
  const { id } = await params;
  const productId = z.uuid().safeParse(id);
  if (!productId.success) notFound();

  const { businessId } = await requireBusinessOwner();
  const supabase = await createSupabaseServerClient();
  const product = await findProduct(supabase, businessId, productId.data);
  if (!product) notFound();

  return (
    <div className="flex max-w-lg flex-col gap-4">
      <BackLink href="/dashboard/products" label="Produk" />
      <h1 className="text-2xl font-bold text-ink">Ubah produk</h1>
      <Card>
        <ProductForm
          action={updateProductAction}
          submitLabel="Simpan perubahan"
          existing={{ productId: product.id, version: product.version, photoUrl: product.photoUrl }}
          initialValues={{
            name: product.name,
            description: product.description ?? "",
            basePrice: String(product.basePriceIdr),
            costQuality: product.costQuality,
            variableCost: product.variableCostIdr === null ? "" : String(product.variableCostIdr),
          }}
        />
      </Card>
    </div>
  );
}
