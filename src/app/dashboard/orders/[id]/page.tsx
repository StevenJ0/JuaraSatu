import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { site } from "@/config/site";
import { Badge } from "@/components/owner/badge";
import { BackLink } from "@/components/owner/back-link";
import { Card } from "@/components/owner/card";
import { SavedToast } from "@/components/owner/saved-toast";
import { formatIdr } from "@/lib/format-idr";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatDateOnly, formatWibDateTime } from "@/lib/wib-time";
import { requireBusinessOwner } from "@/features/business/guard";
import { AdvanceOrderButton, CancelOrderForm, ExpireOrderButton } from "@/features/orders/components/order-actions";
import { OrderBadges } from "@/features/orders/components/order-badges";
import { findOrder, findOrderProductionCost, listOrderEvents } from "@/features/orders/repository";
import { cancelWillReleaseSlot, canCancelOrder, isPaymentOverdue, nextOrderStep } from "@/features/orders/status";

export const metadata: Metadata = { title: `Detail Pesanan | ${site.name}` };

const SAVED_NOTICES = new Map<unknown, string>([
  ["created", "Pesanan tercatat."],
  ["mark_paid", "Pesanan ditandai lunas."],
  ["confirm", "Pesanan dikonfirmasi."],
  ["start_production", "Produksi dimulai."],
  ["mark_ready", "Pesanan siap diambil."],
  ["fulfill", "Pesanan sudah diambil."],
  ["cancelled", "Pesanan dibatalkan."],
  ["expired", "Slot dilepas."],
]);

const EVENT_LABELS = new Map<string, string>([
  ["order_created", "Pesanan dibuat"],
  ["external_payment_confirmed", "Ditandai lunas"],
  ["order_confirmed", "Dikonfirmasi"],
  ["production_started", "Produksi dimulai"],
  ["order_ready", "Siap diambil"],
  ["order_fulfilled", "Sudah diambil"],
  ["order_cancelled", "Dibatalkan"],
  ["order_expired", "Kedaluwarsa, slot dilepas"],
]);

export default async function OrderDetailPage({ params, searchParams }: PageProps<"/dashboard/orders/[id]">) {
  const [{ id }, { saved }] = await Promise.all([params, searchParams]);
  const orderId = z.uuid().safeParse(id);
  if (!orderId.success) notFound();

  const { businessId } = await requireBusinessOwner();
  const supabase = await createSupabaseServerClient();
  const order = await findOrder(supabase, businessId, orderId.data);
  if (!order) notFound();

  const [events, productionCost] = await Promise.all([
    listOrderEvents(supabase, businessId, order.id),
    findOrderProductionCost(supabase, businessId, order.id),
  ]);

  const now = new Date();
  const step = nextOrderStep(order);
  const isOverdue = isPaymentOverdue(order, now);
  const canCancel = canCancelOrder(order);
  const savedMessage = SAVED_NOTICES.get(saved);
  const cancelWarning = cancelWillReleaseSlot(order)
    ? "Pesanan dibatalkan dan slotnya kembali tersedia. Bila sudah dibayar, urus pengembaliannya di luar aplikasi."
    : "Produksi sudah dimulai. Slot tidak kembali dan biaya produksi tetap tercatat.";

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      {savedMessage && <SavedToast key={String(saved)} message={savedMessage} />}
      <div className="flex flex-col gap-2">
        {order.preorderId && <BackLink href={`/dashboard/preorders/${order.preorderId}/orders`} label="Pesanan" />}
        <h1 className="font-mono text-2xl font-medium text-ink">{order.publicOrderNumber}</h1>
        <OrderBadges order={order} now={now} />
      </div>

      <Card>
        <h2 className="text-lg font-semibold text-ink">Rincian</h2>
        <dl className="mt-3 grid gap-3 text-base sm:grid-cols-2">
          <div>
            <dt className="text-sm text-muted">Produk</dt>
            <dd className="break-words text-ink">{order.productName}</dd>
          </div>
          <div>
            <dt className="text-sm text-muted">Jumlah</dt>
            <dd className="text-ink">
              {order.quantity} unit × {formatIdr(order.unitPriceIdr)}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-muted">Total</dt>
            <dd className="font-semibold text-ink">{formatIdr(order.totalIdr)}</dd>
          </div>
          <div>
            <dt className="text-sm text-muted">Tanggal pengambilan</dt>
            <dd className="text-ink">{formatDateOnly(order.fulfillmentDate)}</dd>
          </div>
          <div>
            <dt className="text-sm text-muted">Sumber</dt>
            <dd className="text-ink">{order.source === "manual" ? "Pesanan manual" : "Checkout pembeli"}</dd>
          </div>
          {order.paymentDueAt && order.orderStatus === "pending_payment" && (
            <div>
              <dt className="text-sm text-muted">Batas bayar</dt>
              <dd className="text-ink">{formatWibDateTime(order.paymentDueAt)}</dd>
            </div>
          )}
          {order.cancelReason && (
            <div className="sm:col-span-2">
              <dt className="text-sm text-muted">Alasan pembatalan</dt>
              <dd className="break-words text-ink">{order.cancelReason}</dd>
            </div>
          )}
        </dl>
      </Card>

      <Card>
        <h2 className="text-lg font-semibold text-ink">Pemesan</h2>
        <dl className="mt-3 grid gap-3 text-base sm:grid-cols-2">
          <div>
            <dt className="text-sm text-muted">Nama</dt>
            <dd className="break-words text-ink">{order.customerName}</dd>
          </div>
          <div>
            <dt className="text-sm text-muted">Kontak</dt>
            <dd className="break-words text-ink">{order.customerContact ?? "Tidak diisi"}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-sm text-muted">Email</dt>
            <dd className="break-words text-ink">{order.customerEmail ?? "Tidak diisi"}</dd>
          </div>
        </dl>
      </Card>

      {(step || isOverdue || canCancel) && (
        <Card>
          <h2 className="text-lg font-semibold text-ink">Tindakan</h2>
          {order.orderStatus === "pending_payment" && !isOverdue && (
            <p className="mt-1 max-w-[65ch] text-base text-muted">Menunggu pembeli membayar. Slot ditahan sampai batas bayar.</p>
          )}
          {isOverdue && (
            <p className="mt-1 max-w-[65ch] text-base text-muted">Batas bayar sudah lewat dan slot tidak lagi ditahan. Lepas slot untuk merapikan status pesanan.</p>
          )}
          <div className="mt-4 flex flex-col gap-3">
            {step && <AdvanceOrderButton orderId={order.id} version={order.version} step={step} />}
            {isOverdue && <ExpireOrderButton orderId={order.id} version={order.version} />}
            {canCancel && !isOverdue && <CancelOrderForm orderId={order.id} version={order.version} warning={cancelWarning} />}
          </div>
        </Card>
      )}

      {productionCost && (
        <Card>
          <h2 className="text-lg font-semibold text-ink">Biaya produksi tercatat</h2>
          {productionCost.amountIdr === null ? (
            <div className="mt-2">
              <Badge tone="warning">Biaya belum diketahui</Badge>
            </div>
          ) : (
            <p className="mt-2 flex flex-wrap items-center gap-2 text-base text-ink">
              {formatIdr(productionCost.amountIdr)}
              {productionCost.quality === "estimated" && <Badge tone="warning">Biaya estimasi</Badge>}
            </p>
          )}
        </Card>
      )}

      <Card>
        <h2 className="text-lg font-semibold text-ink">Riwayat</h2>
        <ol className="mt-3 flex flex-col gap-2">
          {events.map((event) => (
            <li key={`${event.eventType}-${event.occurredAt}`} className="flex flex-wrap justify-between gap-x-4 text-base">
              <span className="text-ink">{EVENT_LABELS.get(event.eventType) ?? "Perubahan status"}</span>
              <span className="text-sm text-muted">{formatWibDateTime(event.occurredAt)}</span>
            </li>
          ))}
        </ol>
      </Card>
    </div>
  );
}
