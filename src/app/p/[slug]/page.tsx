import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { loadPublicPreorder } from "@/features/public-preorder/read";
import { PublicPreorderView } from "@/features/public-preorder/page-view";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Preorder | Juara Satu", robots: { index: false, follow: false } };

export default async function PublicPreorderPage({ params }: PageProps<"/p/[slug]">) {
  const { slug } = await params;
  const preorder = await loadPublicPreorder(slug);
  if (!preorder) notFound();
  return <PublicPreorderView preorder={preorder} />;
}
