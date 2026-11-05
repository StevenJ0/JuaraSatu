import type { Metadata } from "next";
import { Plus } from "lucide-react";
import Link from "next/link";
import { site } from "@/config/site";
import { PRIMARY_BUTTON_CLASS } from "@/components/form-message";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireBusinessOwner } from "@/features/business/guard";
import { OrderList } from "@/features/orders/components/order-list";
import { BUSINESS_ORDERS_LIMIT, listBusinessOrders } from "@/features/orders/repository";
import { toOrderFilter } from "@/features/orders/status";

export const metadata: Metadata = { title: `Pesanan | ${site.name}` };

export default async function OrdersPage({ searchParams }: PageProps<"/dashboard/orders">) {
  const { filter } = await searchParams;
  const { businessId } = await requireBusinessOwner();
  const supabase = await createSupabaseServerClient();
  const orders = await listBusinessOrders(supabase, businessId);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink">Pesanan</h1>
          <p className="mt-1 text-base text-muted">Semua pesanan pembeli dan pesanan manual di usaha Anda.</p>
        </div>
        <Link href="/dashboard/orders/new" className={`gap-2 ${PRIMARY_BUTTON_CLASS}`}>
          <Plus aria-hidden size={18} strokeWidth={1.5} />
          Catat pesanan manual
        </Link>
      </div>

      <OrderList orders={orders} now={new Date()} activeFilter={toOrderFilter(filter)} basePath="/dashboard/orders" />

      {orders.length === BUSINESS_ORDERS_LIMIT && (
        <p className="text-sm text-muted">Menampilkan {BUSINESS_ORDERS_LIMIT} pesanan terbaru. Pesanan yang lebih lama bisa dibuka dari halaman preorder-nya.</p>
      )}
    </div>
  );
}
