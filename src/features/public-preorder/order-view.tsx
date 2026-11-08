import { Store } from "lucide-react";
import type { PrivateOrderStatus } from "@/features/orders/private-status";
import { formatIdr } from "@/lib/format-idr";
import { formatDateOnly, formatWibDateTime } from "@/lib/wib-time";
import { BuyerShell, SandboxNotice } from "./page-view";
import { PaymentPanel } from "./payment-panel";
import styles from "./public-preorder.module.css";

/** Teks status untuk pembeli. Status pesanan dan status bayar dipisah, sama seperti di database. */
function buyerStatus(order: PrivateOrderStatus): { label: string; description: string } {
  switch (order.orderStatus) {
    case "pending_payment":
      return { label: "Menunggu pembayaran", description: "Slotmu ditahan sampai batas waktu bayar." };
    case "expired":
      return { label: "Kedaluwarsa", description: "Waktu pembayaran habis dan slot sudah dilepas. Buat pesanan baru bila preorder masih dibuka." };
    case "cancelled":
      return { label: "Dibatalkan", description: "Pesanan ini dibatalkan. Hubungi usaha bila ada pertanyaan." };
    case "requires_review":
      return { label: "Sedang ditinjau usaha", description: "Pembayaran diterima setelah batas waktu. Usaha akan memutuskan apakah pesanan bisa diproses." };
    case "awaiting_confirmation":
      return { label: "Pembayaran terverifikasi", description: "Usaha akan mengonfirmasi pesananmu." };
    case "active":
      if (order.fulfillmentStatus === "in_production") return { label: "Sedang diproduksi", description: "Pesananmu sedang dibuat." };
      if (order.fulfillmentStatus === "ready") return { label: "Siap diambil", description: "Ambil sesuai jadwal dan petunjuk di bawah." };
      if (order.fulfillmentStatus === "fulfilled") return { label: "Sudah diambil", description: "Terima kasih sudah memesan." };
      return { label: "Dikonfirmasi", description: "Pesananmu masuk jadwal produksi." };
  }
}

const PAYMENT_LABELS: Record<PrivateOrderStatus["paymentState"], string> = {
  none: "Belum dibayar",
  applied: "Lunas (simulasi Sandbox)",
  unapplied: "Dibayar, menunggu tinjauan usaha",
};

export function PrivateOrderView({ order, token }: { order: PrivateOrderStatus; token: string }) {
  const status = buyerStatus(order);
  return <BuyerShell>
    <main id="konten-preorder" className={styles.main}>
      <div className={styles.business}><Store size={17} aria-hidden="true" /><span>{order.businessName}</span></div>
      <div className={styles.layout}>
        <section className={styles.detail} aria-labelledby="nomor-pesanan">
          <div className={styles.eyebrow}>{order.preorderName}</div>
          <h1 id="nomor-pesanan">Pesanan {order.publicOrderNumber}</h1>
          <div className={styles.status}><span className={styles.statusLabel}>{status.label}</span><span>{PAYMENT_LABELS[order.paymentState]}</span></div>
          <p className={styles.stateDescription}>{status.description}</p>
          <dl className={styles.summary}>
            <div><dt>Produk</dt><dd>{order.productName} (SKU {order.sku})</dd></div>
            <div><dt>Jumlah</dt><dd>{order.quantity} unit × {formatIdr(order.finalUnitPriceIdr)}</dd></div>
            {order.discountTotalIdr > 0 && <div><dt>Hemat</dt><dd>{formatIdr(order.discountTotalIdr)}</dd></div>}
            <div className={styles.summaryTotal}><dt>Total</dt><dd>{formatIdr(order.totalIdr)}</dd></div>
            {order.paymentVerifiedAt && <div><dt>Pembayaran terverifikasi</dt><dd>{formatWibDateTime(order.paymentVerifiedAt)}</dd></div>}
          </dl>
          {order.canContinuePayment && order.paymentDueAt && (
            <div id="bayar" className={styles.orderArea}>
              <PaymentPanel token={token} totalIdr={order.totalIdr} paymentDueAt={order.paymentDueAt} />
            </div>
          )}
          <p className={styles.stockNote}>Simpan tautan halaman ini untuk melihat status pesanan. Hanya pemegang tautan yang bisa membukanya.</p>
        </section>
        <section className={styles.pickupCard} aria-labelledby="judul-pengambilan">
          <h2 id="judul-pengambilan">Pengambilan</h2>
          <dl>
            <div><dt>Tanggal pengambilan</dt><dd>{formatDateOnly(order.fulfillmentDate)}</dd></div>
            <div><dt>Batas pengambilan</dt><dd>{formatWibDateTime(order.fulfillmentWindowEndAt)}</dd></div>
            <div><dt>Petunjuk pengambilan</dt><dd className={styles.multiline}>{order.pickup.instructions}</dd></div>
            {order.pickup.publicContact && <div><dt>Kontak usaha</dt><dd>{order.pickup.publicContact}</dd></div>}
          </dl>
        </section>
      </div>
      <SandboxNotice />
    </main>
  </BuyerShell>;
}
