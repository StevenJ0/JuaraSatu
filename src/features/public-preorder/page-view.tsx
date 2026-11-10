import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowUpRight, CalendarDays, Store } from "lucide-react";
import { Brand } from "@/components/brand";
import type { PublicPreorder, PublicPreorderAvailability } from "@/features/preorders/context";
import { formatIdr } from "@/lib/format-idr";
import { formatDateOnly, formatWibDateTime } from "@/lib/wib-time";
import { ProductGallery } from "./product-gallery";
import styles from "./public-preorder.module.css";

const stateCopy: Record<PublicPreorderAvailability, readonly [string, string]> = {
  open: ["Preorder dibuka", "Pesananmu dibuat untuk jadwal pengambilan ini."],
  not_started: ["Segera dibuka", "Simpan tautan ini dan kembali saat preorder dibuka."],
  sold_out: ["Kuota sedang penuh", "Seluruh kuota sedang terpakai atau ditahan pembeli lain. Kamu dapat memeriksa kembali nanti."],
  closed: ["Pemesanan ditutup", "Preorder ini sudah tidak menerima pesanan baru. Pesanan yang sudah masuk tetap diproses."],
};

export function BuyerShell({ children }: { children: ReactNode }) {
  return <div className={styles.page}>
    <a href="#konten-preorder" className="skip-link">Langsung ke preorder</a>
    <header className={styles.header}><Brand href="/" /><span>Preorder langsung dari usahanya</span></header>
    {children}
    <footer className={styles.footer}><span>Didukung juarasatu</span><Link href="/">Kenali platform <ArrowUpRight size={15} aria-hidden="true" /></Link></footer>
  </div>;
}

export function SandboxNotice() {
  return <aside className={styles.sandbox}><strong>Mode demo · Midtrans Sandbox</strong><p>Pembayaran pada demo ini merupakan simulasi. Jangan membayar menggunakan aplikasi pembayaran sungguhan.</p></aside>;
}

/** `children` diisi form pesan saat preorder dibuka. Harga dan sisa dari kontrak C1, sama dengan yang dipakai saat memesan. */
export function PublicPreorderView({ preorder, children }: { preorder: PublicPreorder; children?: ReactNode }) {
  const [label, description] = stateCopy[preorder.availability];
  const discounted = preorder.discountBps > 0 && preorder.unitPriceIdr < preorder.basePriceIdr;
  return <BuyerShell>
    <main id="konten-preorder" className={styles.main}>
      <div className={styles.business}><Store size={17} aria-hidden="true" /><span>{preorder.businessName}</span>{preorder.isDemo && <span className={styles.demo}>Usaha demo</span>}</div>
      <div className={styles.layout}>
        <ProductGallery name={preorder.product.name} photos={preorder.product.photos} />
        <section className={styles.detail} aria-labelledby="nama-produk">
          <div className={styles.eyebrow}>{preorder.name}</div>
          <h1 id="nama-produk">{preorder.product.name}</h1>
          <p className={styles.sku}>SKU {preorder.product.sku}</p>
          <p className={styles.price}>
            {formatIdr(preorder.unitPriceIdr)} <span>/ unit</span>
            {discounted && <><br /><s className={styles.basePrice}>{formatIdr(preorder.basePriceIdr)}</s> <span className={styles.discountBadge}>Hemat {formatIdr(preorder.basePriceIdr - preorder.unitPriceIdr)} per unit</span></>}
          </p>
          {preorder.product.description && <p className={styles.description}>{preorder.product.description}</p>}
          <div className={styles.status}><span className={styles.statusLabel}>{label}</span>{preorder.availability === "open" && <span>Tersedia {preorder.orderableUnits} dari kuota {preorder.quotaUnits} unit</span>}</div>
          <p className={styles.stateDescription}>{description}</p>
          <dl className={styles.schedule}>
            {preorder.availability === "not_started" && <div><dt>Dibuka</dt><dd>{formatWibDateTime(preorder.startsAt)}</dd></div>}
            <div><dt>Batas pemesanan</dt><dd>{formatWibDateTime(Date.parse(preorder.endsAt) < Date.parse(preorder.intakeCutoffAt) ? preorder.endsAt : preorder.intakeCutoffAt)}</dd></div>
            <div><dt><CalendarDays size={15} aria-hidden="true" /> Ambil pesanan</dt><dd>{formatDateOnly(preorder.fulfillmentDate)}</dd></div>
          </dl>
          {children && <div id="pesan" className={styles.orderArea}>{children}</div>}
          <p className={styles.stockNote}>Ketersediaan dapat berubah. Jumlah akhir diperiksa kembali saat pesanan dibuat.</p>
        </section>
      </div>
      <section id="pengambilan" className={styles.pickup} aria-labelledby="judul-pengambilan">
        <div><p className={styles.eyebrow}>Sudah tahu mau pesan berapa?</p><h2 id="judul-pengambilan">Catat jadwal pengambilannya.</h2><p>Pesanan diambil langsung sesuai ketentuan usaha.</p></div>
        <dl><div><dt>Tanggal pengambilan</dt><dd>{formatDateOnly(preorder.fulfillmentDate)}</dd></div><div><dt>Batas pengambilan</dt><dd>{formatWibDateTime(preorder.fulfillmentWindowEndAt)}</dd></div><div><dt>Petunjuk pengambilan</dt><dd className={styles.multiline}>{preorder.pickup.instructions}</dd></div>{preorder.pickup.publicContact && <div><dt>Kontak usaha</dt><dd>{preorder.pickup.publicContact}</dd></div>}</dl>
      </section>
      <SandboxNotice />
    </main>
  </BuyerShell>;
}
