import type { Metadata } from "next";
import { Plus } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { site } from "@/config/site";
import { PRIMARY_BUTTON_CLASS } from "@/components/form-message";
import { BackLink } from "@/components/owner/back-link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatDateOnly } from "@/lib/wib-time";
import { requireBusinessOwner } from "@/features/business/guard";
import { OrderList } from "@/features/orders/components/order-list";
import { listPreorderOrders } from "@/features/orders/repository";
import { toOrderFilter } from "@/features/orders/status";
import { findPreorder } from "@/features/preorders/repository";

export const metadata: Metadata = { title: `Pesanan Preorder | ${site.name}` };

export default async function PreorderOrdersPage({ params, searchParams }: PageProps<"/dashboard/preorders/[id]/orders">) {
  const [{ id }, { filter }] = await Promise.all([params, searchParams]);
  const preorderId = z.uuid().safeParse(id);
  if (!preorderId.success) notFound();

  const { businessId } = await requireBusinessOwner();
  const supabase = await createSupabaseServerClient();
  const preorder = await findPreorder(supabase, businessId, preorderId.data);
  if (!preorder) notFound();

  const orders = await listPreorderOrders(supabase, businessId, preorder.id);
  const basePath = `/dashboard/preorders/${preorder.id}/orders`;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <BackLink href={`/dashboard/preorders/${preorder.id}`} label={preorder.name} />
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-ink">Pesanan</h1>
            <p className="mt-1 text-base text-muted">
              {preorder.productName} · pengambilan {formatDateOnly(preorder.fulfillmentDate)}
            </p>
          </div>
          {preorder.status === "published" && (
            <Link href={`${basePath}/new`} className={`gap-2 ${PRIMARY_BUTTON_CLASS}`}>
              <Plus aria-hidden size={18} strokeWidth={1.5} />
              Catat pesanan manual
            </Link>
          )}
        </div>
      </div>

      <OrderList orders={orders} now={new Date()} activeFilter={toOrderFilter(filter)} basePath={basePath} />
    </div>
  );
}
