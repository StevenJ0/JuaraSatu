import type { Metadata } from "next";
import { Plus } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { site } from "@/config/site";
import { PRIMARY_BUTTON_CLASS } from "@/components/form-message";
import { BackLink } from "@/components/owner/back-link";
import { Card } from "@/components/owner/card";
import { KpiCard } from "@/components/owner/kpi-card";
import { formatIdr } from "@/lib/format-idr";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatDateOnly } from "@/lib/wib-time";
import { requireBusinessOwner } from "@/features/business/guard";
import { OrderBadges } from "@/features/orders/components/order-badges";
import { summarizeOrders } from "@/features/orders/recap";
import { listPreorderOrders, type Order } from "@/features/orders/repository";
import { ORDER_FILTERS, matchesOrderFilter, toOrderFilter } from "@/features/orders/status";
import { findPreorder } from "@/features/preorders/repository";

export const metadata: Metadata = { title: `Pesanan Preorder | ${site.name}` };

const ROW_GRID = "md:grid md:grid-cols-[10rem_minmax(0,1fr)_5rem_7rem_minmax(0,16rem)] md:items-center md:gap-4";

function OrderRow({ order, now }: { order: Order; now: Date }) {
  return (
    <li>
      <Link href={`/dashboard/orders/${order.id}`} className={`flex flex-col gap-1 p-4 transition-colors hover:bg-subtle sm:px-6 ${ROW_GRID}`}>
        <span className="font-mono text-sm font-medium text-ink">{order.publicOrderNumber}</span>
        <span className="min-w-0 truncate text-base font-medium text-ink">{order.customerName}</span>
        <span className="text-sm text-ink">{order.quantity} unit</span>
        <span className="text-sm text-ink">{formatIdr(order.totalIdr)}</span>
        <OrderBadges order={order} now={now} />
      </Link>
    </li>
  );
}

export default async function PreorderOrdersPage({ params, searchParams }: PageProps<"/dashboard/preorders/[id]/orders">) {
  const [{ id }, { filter }] = await Promise.all([params, searchParams]);
  const preorderId = z.uuid().safeParse(id);
  if (!preorderId.success) notFound();

  const { businessId } = await requireBusinessOwner();
  const supabase = await createSupabaseServerClient();
  const preorder = await findPreorder(supabase, businessId, preorderId.data);
  if (!preorder) notFound();

  const orders = await listPreorderOrders(supabase, businessId, preorder.id);
  const now = new Date();
  const activeFilter = toOrderFilter(filter);
  const visibleOrders = orders.filter((order) => matchesOrderFilter(order, activeFilter, now));
  const recap = summarizeOrders(orders, now);
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

      <section aria-label="Rekap pesanan" className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="Perlu dibuat" value={`${recap.unitsToProduce} unit`} note="Belum sampai siap diambil" />
        <KpiCard label="Perlu tindakan" value={String(recap.ordersNeedingAction)} note="Pesanan perlu dikonfirmasi atau dilunasi" />
        <KpiCard label="Siap diambil" value={`${recap.unitsReady} unit`} note="Menunggu pembeli" />
        <KpiCard label="Sudah diambil" value={`${recap.unitsFulfilled} unit`} note="Selesai" />
      </section>

      <nav aria-label="Saring pesanan" className="flex flex-wrap gap-2">
        {ORDER_FILTERS.map((option) => {
          const isActive = option.value === activeFilter;
          return (
            <Link
              key={option.value}
              href={option.value === "all" ? basePath : `${basePath}?filter=${option.value}`}
              aria-current={isActive ? "page" : undefined}
              className={`inline-flex min-h-9 items-center rounded-full border px-3 py-1 text-sm transition-colors ${
                isActive
                  ? "border-brand bg-[var(--owner-highlight)] font-semibold text-[color:var(--owner-primary-strong)]"
                  : "border-line bg-surface font-medium text-ink hover:border-brand"
              }`}
            >
              {option.label}
            </Link>
          );
        })}
      </nav>

      {visibleOrders.length === 0 ? (
        <Card>
          <p className="text-base text-muted">
            {orders.length === 0 ? "Belum ada pesanan. Pesanan pembeli dan pesanan manual akan tampil di sini." : "Tidak ada pesanan pada saringan ini."}
          </p>
        </Card>
      ) : (
        <Card padded={false}>
          <div aria-hidden className={`hidden rounded-t-[14px] bg-subtle px-6 py-2 text-xs font-semibold text-muted md:grid ${ROW_GRID}`}>
            <span>Nomor</span>
            <span>Pemesan</span>
            <span>Jumlah</span>
            <span>Total</span>
            <span>Status</span>
          </div>
          <ul className="divide-y divide-line">
            {visibleOrders.map((order) => (
              <OrderRow key={order.id} order={order} now={now} />
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
