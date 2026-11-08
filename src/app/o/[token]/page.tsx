import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { findOrderByPrivateToken } from "@/features/orders/service";
import { PrivateOrderView } from "@/features/public-preorder/order-view";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/service-role";

// Halaman bertoken (FR-PAY-06): selalu dirender ulang, tidak diindeks, dan tidak mengirim alamatnya sebagai referrer.
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Pesanan | Juara Satu", robots: { index: false, follow: false }, referrer: "no-referrer" };

export default async function PrivateOrderPage({ params }: PageProps<"/o/[token]">) {
  const { token } = await params;
  const order = await findOrderByPrivateToken(createSupabaseServiceRoleClient(), token);
  if (!order) notFound();
  return <PrivateOrderView order={order} token={token} />;
}
