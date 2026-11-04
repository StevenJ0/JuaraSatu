import type { Metadata } from "next";
import { randomUUID } from "node:crypto";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { site } from "@/config/site";
import { BackLink } from "@/components/owner/back-link";
import { Card } from "@/components/owner/card";
import { formatIdr } from "@/lib/format-idr";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireBusinessOwner } from "@/features/business/guard";
import { ManualOrderForm } from "@/features/orders/components/manual-order-form";
import { findPreorder } from "@/features/preorders/repository";

export const metadata: Metadata = { title: `Catat Pesanan Manual | ${site.name}` };

export default async function NewManualOrderPage({ params }: PageProps<"/dashboard/preorders/[id]/orders/new">) {
  const { id } = await params;
  const preorderId = z.uuid().safeParse(id);
  if (!preorderId.success) notFound();

  const { businessId } = await requireBusinessOwner();
  const supabase = await createSupabaseServerClient();
  const preorder = await findPreorder(supabase, businessId, preorderId.data);
  if (!preorder) notFound();

  const ordersPath = `/dashboard/preorders/${preorder.id}/orders`;
  if (preorder.status !== "published") redirect(ordersPath);

  return (
    <div className="flex max-w-lg flex-col gap-4">
      <BackLink href={ordersPath} label="Pesanan" />
      <div>
        <h1 className="text-2xl font-bold text-ink">Catat pesanan manual</h1>
        <p className="mt-1 text-base text-muted">
          {preorder.productName} · {formatIdr(preorder.basePriceIdr)} per unit
        </p>
      </div>
      <Card>
        <ManualOrderForm
          preorderId={preorder.id}
          idempotencyKey={randomUUID()}
          quantityHint={`Bisa dipesan ${preorder.metrics.orderableUnits} unit lagi. Memakai kuota dan kapasitas yang sama dengan pesanan pembeli.`}
        />
      </Card>
    </div>
  );
}
