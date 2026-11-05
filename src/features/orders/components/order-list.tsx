import Link from "next/link";
import { Card } from "@/components/owner/card";
import { KpiCard } from "@/components/owner/kpi-card";
import { formatIdr } from "@/lib/format-idr";
import { OrderBadges } from "@/features/orders/components/order-badges";
import { summarizeOrders } from "@/features/orders/recap";
import type { Order } from "@/features/orders/repository";
import { ORDER_FILTERS, matchesOrderFilter, type OrderFilter } from "@/features/orders/status";

const ROW_GRID = "md:grid md:grid-cols-[10rem_minmax(0,1fr)_5rem_7rem_minmax(0,16rem)] md:items-center md:gap-4";

function OrderRow({ order, now }: { order: Order; now: Date }) {
  return (
    <li>
      <Link href={`/dashboard/orders/${order.id}`} className={`flex flex-col gap-1 p-4 transition-colors hover:bg-subtle sm:px-6 ${ROW_GRID}`}>
        <span className="font-mono text-sm font-medium text-ink">{order.publicOrderNumber}</span>
        <span className="min-w-0">
          <span className="block truncate text-base font-medium text-ink">{order.customerName}</span>
          <span className="block truncate text-sm text-muted">{order.productName}</span>
        </span>
        <span className="text-sm text-ink">{order.quantity} unit</span>
        <span className="text-sm text-ink">{formatIdr(order.totalIdr)}</span>
        <OrderBadges order={order} now={now} />
      </Link>
    </li>
  );
}

type OrderListProps = {
  orders: Order[];
  now: Date;
  activeFilter: OrderFilter;
  basePath: string;
};

/** Dipakai daftar per preorder dan daftar semua pesanan, supaya rekap dan saringannya selalu sama. */
export function OrderList({ orders, now, activeFilter, basePath }: OrderListProps) {
  const visibleOrders = orders.filter((order) => matchesOrderFilter(order, activeFilter, now));
  const recap = summarizeOrders(orders, now);

  return (
    <>
      <section aria-label="Rekap pesanan" className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="Perlu dibuat" value={`${recap.unitsToProduce} unit`} note="Belum sampai siap diambil" />
        <KpiCard label="Perlu tindakan" value={String(recap.ordersNeedingAction)} note="Pesanan perlu dikonfirmasi, dilunasi, atau ditinjau" />
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
    </>
  );
}
