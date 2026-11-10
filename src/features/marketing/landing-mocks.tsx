import type { ReactNode } from "react";
import {
  BadgeCheck,
  CalendarDays,
  Check,
  Link2,
  Mail,
  QrCode,
  ShoppingBag,
  Sparkles,
  Target,
  TrendingUp,
} from "lucide-react";
import styles from "./landing-mocks.module.css";

/** Semua angka dan nama di berkas ini adalah contoh tampilan, bukan data usaha sungguhan. */

const CHIP_ICONS = {
  order: ShoppingBag,
  paid: BadgeCheck,
  capacity: CalendarDays,
  ai: Sparkles,
  mail: Mail,
  target: Target,
} as const;

export type ChipIcon = keyof typeof CHIP_ICONS;

export function ChipCard({ icon, title, meta }: { icon: ChipIcon; title: string; meta: string }) {
  const IconComponent = CHIP_ICONS[icon];
  return (
    <div className={styles.chip}>
      <span className={styles.chipIcon} data-icon={icon}>
        <IconComponent aria-hidden size={18} strokeWidth={2} />
      </span>
      <span className={styles.chipText}>
        <strong>{title}</strong>
        <span>{meta}</span>
      </span>
    </div>
  );
}

function MockFrame({ title, children, className = "" }: { title: string; children: ReactNode; className?: string }) {
  return (
    <div className={`${styles.frame} ${className}`}>
      <div className={styles.frameBar}>
        <span className={styles.frameDots} aria-hidden="true"><i /><i /><i /></span>
        <span>{title}</span>
      </div>
      <div className={styles.frameBody}>{children}</div>
    </div>
  );
}

function Progress({ value, max }: { value: number; max: number }) {
  return (
    <span className={styles.progress} aria-hidden="true">
      <span style={{ width: `${Math.min((value / max) * 100, 100)}%` }} />
    </span>
  );
}

export function SummaryMock() {
  return (
    <MockFrame title="Ringkasan · Dapur Bu Sari" className={styles.summary}>
      <div className={styles.alert}>2 pesanan perlu tindakan</div>
      <div className={styles.statGrid}>
        <div><span>Pembayaran masuk</span><strong>Rp1.240.000</strong><em>Simulasi</em></div>
        <div><span>Perlu dibuat</span><strong>18 unit</strong></div>
        <div><span>Siap diambil</span><strong>6 unit</strong></div>
        <div><span>Sudah diambil</span><strong>24 unit</strong></div>
      </div>
      <div className={styles.rows}>
        <div className={styles.row}>
          <span><strong>Brownies Batch Sabtu</strong><small>Tutup 15 Nov, 20.00</small></span>
          <span className={styles.rowProgress}><small>32/40 unit</small><Progress value={32} max={40} /></span>
          <span className={styles.badgeGood}>Sesuai laju</span>
        </div>
        <div className={styles.row}>
          <span><strong>Nastar Lebaran</strong><small>Tutup 18 Nov, 20.00</small></span>
          <span className={styles.rowProgress}><small>9/50 unit</small><Progress value={9} max={50} /></span>
          <span className={styles.badgeWarn}>Di bawah laju</span>
        </div>
      </div>
    </MockFrame>
  );
}

export function PreorderPageMock() {
  return (
    <MockFrame title="Halaman pesanan · /p/brownies-sabtu">
      <div className={styles.buyer}>
        <div className={styles.buyerPhoto} aria-hidden="true" />
        <div>
          <span className={styles.muted}>Dapur Bu Sari</span>
          <strong className={styles.buyerTitle}>Brownies Panggang</strong>
          <strong className={styles.price}>Rp45.000 <small>/ kotak</small></strong>
          <span className={styles.pill}>Tersedia 8 dari kuota 40</span>
          <span className={styles.muted}>Ambil Sabtu, 15 Nov</span>
        </div>
      </div>
      <div className={styles.buyerAction}>Pesan sekarang</div>
    </MockFrame>
  );
}

export function CapacityMock() {
  return (
    <MockFrame title="Kapasitas produksi">
      <div className={styles.capacity}>
        <div className={styles.capacityHead}><strong>Sabtu, 15 Nov</strong><span>40 unit</span></div>
        <span className={styles.capacityBar} aria-hidden="true"><i style={{ width: "60%" }} /><b style={{ width: "20%" }} /></span>
        <dl className={styles.legend}>
          <div><dt><i data-key="paid" />Sudah dibayar</dt><dd>24</dd></div>
          <div><dt><i data-key="held" />Menunggu bayar</dt><dd>8</dd></div>
          <div><dt><i data-key="open" />Masih bisa dipesan</dt><dd>8</dd></div>
        </dl>
        <p className={styles.note}>Pesanan baru ditolak saat kuota habis.</p>
      </div>
    </MockFrame>
  );
}

/** Halaman status pesanan pribadi milik pembeli (tautan /o/...), tempat QRIS dibayar dan statusnya dipantau. */
export function BuyerStatusMock() {
  return (
    <MockFrame title="Status pesanan · #JS-1042">
      <div className={styles.qris}>
        <div className={styles.qrBox} aria-hidden="true"><QrCode size={72} strokeWidth={1.25} /></div>
        <div>
          <span className={styles.muted}>Brownies Panggang · 2 kotak</span>
          <strong className={styles.price}>Rp90.000</strong>
          <span className={styles.paidPill}><Check aria-hidden size={14} strokeWidth={3} />Lunas, terverifikasi</span>
          <span className={styles.sandbox}>Midtrans Sandbox · simulasi</span>
        </div>
      </div>
      <p className={styles.note}>Ambil Sabtu, 15 Nov · tautan ini hanya untuk pembeli.</p>
    </MockFrame>
  );
}

/** Email otomatis yang benar-benar dikirim aplikasi: menunggu pembayaran dan lunas ke pembeli, order lunas ke penjual. */
export function EmailMock() {
  const emails = [
    { to: "Ke pembeli", subject: "Satu langkah lagi: bayar pesanan JS-1042", meta: "Berisi tautan status pesanan" },
    { to: "Ke pembeli", subject: "Pembayaran diterima! Pesanan JS-1042 siap diproses", meta: "Rincian dan jadwal ambil" },
    { to: "Ke kamu", subject: "Order baru lunas: JS-1042, Brownies x2", meta: "Siapkan pesanan untuk Sabtu" },
  ];
  return (
    <MockFrame title="Email otomatis">
      <ul className={styles.inbox}>
        {emails.map((email) => (
          <li key={email.subject}>
            <span className={styles.inboxIcon} aria-hidden="true"><Mail size={16} /></span>
            <span className={styles.inboxText}>
              <small>{email.to}</small>
              <strong>{email.subject}</strong>
              <span>{email.meta}</span>
            </span>
          </li>
        ))}
      </ul>
    </MockFrame>
  );
}

export function AiMock() {
  return (
    <MockFrame title="Campaign AI">
      <div className={styles.ai}>
        <p className={styles.aiDiag}><TrendingUp aria-hidden size={16} />Kurang 41 unit, butuh 7 unit/hari</p>
        <div className={styles.aiCard}>
          <span className={styles.aiTag}><Sparkles aria-hidden size={13} />Usulan</span>
          <strong>Titip jual lewat komunitas arisan</strong>
          <span>Paket 2 toples untuk grup, ambil bersama di satu titik.</span>
        </div>
        <div className={styles.aiChecklist}>
          <span><Check aria-hidden size={14} />Rencana 5 hari</span>
          <span><Check aria-hidden size={14} />Checklist harian</span>
          <span><Check aria-hidden size={14} />Caption siap pakai</span>
        </div>
      </div>
    </MockFrame>
  );
}

export function ProductMock() {
  return (
    <MockFrame title="Tambah produk">
      <div className={styles.product}>
        <div className={styles.photos} aria-hidden="true">
          <i data-main="true"><span>Utama</span></i><i /><i /><b>+ Tambah</b>
        </div>
        <span className={styles.muted}>3/5 foto</span>
        <div className={styles.field}><span>Nama produk</span><strong>Brownies Panggang</strong></div>
        <div className={styles.fieldRow}>
          <div className={styles.field}><span>Harga jual</span><strong>Rp45.000</strong></div>
          <div className={styles.field}><span>Modal per unit</span><strong>Rp21.000</strong></div>
        </div>
      </div>
    </MockFrame>
  );
}

export function ShareMock() {
  return (
    <MockFrame title="Preorder terbit">
      <div className={styles.share}>
        <span className={styles.paidPill}><Check aria-hidden size={14} strokeWidth={3} />Sudah terbit</span>
        <strong className={styles.buyerTitle}>Brownies Batch Sabtu</strong>
        <span className={styles.muted}>Target 40 unit · kuota 40 unit</span>
        <div className={styles.linkBox}><Link2 aria-hidden size={16} /><span>/p/brownies-sabtu</span><b>Salin</b></div>
        <div className={styles.channels} aria-hidden="true"><i>WhatsApp</i><i>Instagram</i><i>Grup pelanggan</i></div>
      </div>
    </MockFrame>
  );
}

export function OrderStepsMock() {
  const steps = ["Dikonfirmasi", "Diproduksi", "Siap diambil", "Selesai"];
  return (
    <MockFrame title="Pesanan #JS-1042">
      <div className={styles.orderHead}><strong>Rina · 2 kotak</strong><span className={styles.paidPill}>Lunas (sandbox)</span></div>
      <ol className={styles.timeline}>
        {steps.map((step, index) => (
          <li key={step} data-done={index < 3}>
            <i aria-hidden="true">{index < 3 && <Check size={12} strokeWidth={3} />}</i>{step}
          </li>
        ))}
      </ol>
      <div className={styles.buyerAction}>Tandai diambil</div>
    </MockFrame>
  );
}
