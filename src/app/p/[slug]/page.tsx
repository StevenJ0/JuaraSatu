import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { loadPublicPreorder } from "@/features/public-preorder/read";
import { PublicPreorderView } from "@/features/public-preorder/page-view";
import { CheckoutForm } from "@/features/public-preorder/checkout-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Preorder | juarasatu", robots: { index: false, follow: false } };

export default async function PublicPreorderPage({ params, searchParams }: PageProps<"/p/[slug]">) {
  const { slug } = await params;
  const { ref } = await searchParams;
  const preorder = await loadPublicPreorder(slug);
  if (!preorder) notFound();
  return (
    <PublicPreorderView preorder={preorder}>
      {preorder.availability === "open" && (
        <CheckoutForm
          key={preorder.slug}
          slug={preorder.slug}
          unitPriceIdr={preorder.unitPriceIdr}
          orderableUnits={preorder.orderableUnits}
          attributionRef={typeof ref === "string" ? ref : null}
        />
      )}
    </PublicPreorderView>
  );
}
