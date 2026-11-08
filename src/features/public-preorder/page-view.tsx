import type { ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowDown, ArrowUpRight, CalendarDays, Package, Store } from "lucide-react";
import { Brand } from "@/components/brand";
import { formatIdr } from "@/lib/format-idr";
import { formatDateOnly, formatWibDateTime } from "@/lib/wib-time";
import type { PublicPreorder } from "./read";
import styles from "./public-preorder.module.css";

const stateCopy = {
  open: ["Preorder dibuka", "Pesananmu dibuat untuk jadwal pengambilan ini."],
  scheduled: ["Segera dibuka", "Simpan tautan ini dan kembali saat preorder dibuka."],
  full: ["Kuota sedang penuh", "Seluruh kuota sedang terpakai atau ditahan pembeli lain. Kamu dapat memeriksa kembali nanti."],
  closed: ["Pemesanan ditutup", "Preorder ini sudah tidak menerima pesanan baru. Pesanan yang sudah masuk tetap diproses."],
  completed: ["Preorder selesai", "Jadwal preorder ini telah selesai."],
  cancelled: ["Preorder dibatalkan", "Preorder ini tidak menerima pesanan baru. Hubungi usaha jika kamu sudah memiliki pesanan."],
} as const;

export function BuyerShell({ children }: { children: ReactNode }) {
  return <div className={styles.page}>
    <a href="#konten-preorder" className="skip-link">Langsung ke preorder</a>
    <header className={styles.header}><Brand href="/" /><span>Preorder langsung dari usahanya</span></header>
    {children}
    <footer className={styles.footer}><span>Didukung Juara Satu</span><Link href="/">Kenali platform <ArrowUpRight size={15} aria-hidden="true" /></Link></footer>
  </div>;
}

export function PublicPreorderView({ preorder, children }: { preorder: PublicPreorder; children?: ReactNode }) {
  const [label, description] = stateCopy[preorder.state];
  return <BuyerShell>
    <main id="konten-preorder" className={styles.main}>
      <div className={styles.business}><Store size={17} aria-hidden="true" /><span>{preorder.business.name}</span>{preorder.business.isDemo && <span className={styles.demo}>Usaha demo</span>}</div>
      <div className={styles.layout}>
        <div className={styles.photo}>
          {preorder.product.photoUrl
            ? <Image src={preorder.product.photoUrl} alt={preorder.product.name} width={1000} height={1100} priority unoptimized className={styles.productImage} />
            : <div className={styles.noPhoto}><Package size={48} strokeWidth={1} aria-hidden="true" /><span>Foto produk belum tersedia</span></div>}
          <span className={styles.photoCaption}>Satu produk. Satu jadwal pengambilan.</span>
        </div>
        <section className={styles.detail} aria-labelledby="nama-produk">
          <div className={styles.eyebrow}>{preorder.name}</div>
          <h1 id="nama-produk">{preorder.product.name}</h1>
          <p className={styles.sku}>SKU {preorder.product.sku}</p>
          <p className={styles.price}>{formatIdr(preorder.offer.unitPriceIdr)} <span>/ unit</span></p>
          {preorder.product.description && <p className={styles.description}>{preorder.product.description}</p>}
          <div className={styles.status}><span className={styles.statusLabel}>{label}</span>{preorder.state === "open" && <span>Tersedia {preorder.availableUnits} dari kuota {preorder.quotaUnits} unit</span>}</div>
          <p className={styles.stateDescription}>{description}</p>
          <dl className={styles.schedule}>
            {preorder.state === "scheduled" && <div><dt>Dibuka</dt><dd>{formatWibDateTime(preorder.startsAt)}</dd></div>}
            <div><dt>Batas pemesanan</dt><dd>{formatWibDateTime(preorder.orderDeadlineAt)}</dd></div>
            <div><dt><CalendarDays size={15} aria-hidden="true" /> Ambil pesanan</dt><dd>{formatDateOnly(preorder.fulfillmentDate)}</dd></div>
          </dl>
          <div id="pesan" className={styles.orderArea}>
            {children ?? <><p className={styles.orderTitle}>Pemesanan lewat website sedang disiapkan</p><p>Untuk keterangan preorder, lihat petunjuk dan kontak usaha di bawah.</p><a href="#pengambilan" className={styles.textLink}>Lihat cara pengambilan <ArrowDown size={16} aria-hidden="true" /></a></>}
          </div>
          <p className={styles.stockNote}>Ketersediaan dapat berubah. Jumlah akhir diperiksa kembali saat pesanan dibuat.</p>
        </section>
      </div>
      <section id="pengambilan" className={styles.pickup} aria-labelledby="judul-pengambilan">
        <div><p className={styles.eyebrow}>Sudah tahu mau pesan berapa?</p><h2 id="judul-pengambilan">Catat jadwal pengambilannya.</h2><p>Pesanan diambil langsung sesuai ketentuan usaha.</p></div>
        <dl><div><dt>Tanggal pengambilan</dt><dd>{formatDateOnly(preorder.fulfillmentDate)}</dd></div><div><dt>Batas pengambilan</dt><dd>{formatWibDateTime(preorder.pickupUntil)}</dd></div><div><dt>Petunjuk pengambilan</dt><dd className={styles.multiline}>{preorder.pickupInstructions}</dd></div>{preorder.publicContact && <div><dt>Kontak usaha</dt><dd>{preorder.publicContact}</dd></div>}</dl>
      </section>
      <aside className={styles.sandbox}><strong>Mode demo · Midtrans Sandbox</strong><p>Pembayaran pada demo ini merupakan simulasi. Jangan membayar menggunakan aplikasi pembayaran sungguhan.</p></aside>
    </main>
  </BuyerShell>;
}
