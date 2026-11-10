import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowUpRight, CalendarDays, Store } from "lucide-react";
import { Brand } from "@/components/brand";
import type { PublicPreorder, PublicPreorderAvailability } from "@/features/preorders/context";
import { formatIdr } from "@/lib/format-idr";
import { formatDateOnly, formatWibDateTime } from "@/lib/wib-time";
import { ProductDescription } from "./product-description";
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
      {/* Desktop: galeri dan info pengambilan di kiri, detail dan form di kanan. Ponsel: galeri, detail + form, lalu pengambilan. */}
      <div className={styles.productLayout}>
        <div className={styles.productMedia}><ProductGallery name={preorder.product.name} photos={preorder.product.photos} /></div>
        <section className={styles.productDetail} aria-labelledby="nama-produk">
          <div className={styles.seller}>
            <Store size={16} aria-hidden="true" /><strong>{preorder.businessName}</strong>
            {preorder.isDemo && <span className={styles.demo}>Usaha demo</span>}
            <span className={styles.sellerDivider} aria-hidden="true">·</span><span>{preorder.name}</span>
          </div>
          <h1 id="nama-produk">{preorder.product.name}</h1>
          <p className={styles.sku}>SKU {preorder.product.sku}</p>
          <p className={styles.price}>
            {formatIdr(preorder.unitPriceIdr)} <span>/ unit</span>
            {discounted && <><br /><s className={styles.basePrice}>{formatIdr(preorder.basePriceIdr)}</s> <span className={styles.discountBadge}>Hemat {formatIdr(preorder.basePriceIdr - preorder.unitPriceIdr)} per unit</span></>}
          </p>
          {preorder.product.description && <section className={styles.about} aria-labelledby="judul-tentang-produk">
            <h2 id="judul-tentang-produk">Tentang produk</h2>
            <ProductDescription text={preorder.product.description} />
          </section>}
          <div className={styles.facts}>
            <div className={styles.status}>
              <span className={styles.statusLabel}>{label}</span>
              {preorder.availability === "open" && <span>Tersedia <strong>{preorder.orderableUnits}</strong> dari {preorder.quotaUnits} unit</span>}
            </div>
            {preorder.availability === "open" && preorder.quotaUnits > 0 && (
              <span className={styles.quotaBar} aria-hidden="true"><span style={{ width: `${Math.min((preorder.orderableUnits / preorder.quotaUnits) * 100, 100)}%` }} /></span>
            )}
            {preorder.availability !== "open" && <p className={styles.stateDescription}>{description}</p>}
            <dl className={styles.schedule}>
              {preorder.availability === "not_started" && <div><dt>Dibuka</dt><dd>{formatWibDateTime(preorder.startsAt)}</dd></div>}
              <div><dt>Batas pemesanan</dt><dd>{formatWibDateTime(Date.parse(preorder.endsAt) < Date.parse(preorder.intakeCutoffAt) ? preorder.endsAt : preorder.intakeCutoffAt)}</dd></div>
              <div><dt><CalendarDays size={14} aria-hidden="true" /> Ambil pesanan</dt><dd>{formatDateOnly(preorder.fulfillmentDate)}</dd></div>
            </dl>
          </div>
          {children && <div id="pesan" className={styles.orderArea}>{children}</div>}
          {children && <p className={styles.stockNote}>Ketersediaan dapat berubah. Jumlah akhir diperiksa kembali saat pesanan dibuat.</p>}
        </section>
        <aside className={styles.productAside}>
          <section id="pengambilan" className={styles.pickupCard} aria-labelledby="judul-pengambilan">
            <h2 id="judul-pengambilan">Pengambilan pesanan</h2>
            <dl>
              <div><dt>Paling lambat diambil</dt><dd>{formatWibDateTime(preorder.fulfillmentWindowEndAt)}</dd></div>
              <div><dt>Petunjuk</dt><dd className={styles.multiline}>{preorder.pickup.instructions}</dd></div>
              {preorder.pickup.publicContact && <div><dt>Kontak usaha</dt><dd>{preorder.pickup.publicContact}</dd></div>}
            </dl>
          </section>
          <SandboxNotice />
        </aside>
      </div>
    </main>
  </BuyerShell>;
}
