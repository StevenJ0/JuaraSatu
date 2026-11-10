import type { ReactNode } from "react";
import { Brand } from "@/components/brand";
import { ButtonLink } from "@/components/ui/button-link";
import { Icon } from "@/components/ui/icon";
import { authLinks, landingNavigation } from "@/config/site";
import { AiMock, BuyerStatusMock, CapacityMock, EmailMock, OrderStepsMock, PreorderPageMock, ProductMock, ShareMock, SummaryMock } from "./landing-mocks";
import { FeatureScroller, ScrollDrawEffects, UnifyScene, type Feature } from "./landing-scenes";
import { MobileNavigation } from "./mobile-navigation";
import { RotatingPhrase } from "./rotating-phrase";
import { PlatformFooter } from "./platform-footer";
import styles from "./landing.module.css";

const features: Feature[] = [
  {
    word: "Preorder",
    title: "Halaman pesanan siap dibagikan",
    description: "Susun preorder sebagai draf, periksa lagi target, kuota, dan tanggal ambilnya, lalu terbitkan. Pembeli memesan dari satu tautan tanpa perlu membuat akun.",
    visual: <PreorderPageMock />,
  },
  {
    word: "Kapasitas",
    title: "Kuota sesuai kemampuan produksi",
    description: "Atur berapa unit yang sanggup dibuat per tanggal ambil, lengkap dengan batas pemesanan. Pesanan baru ditolak saat kuota habis, jadi kamu tidak menjanjikan lebih dari yang bisa dibuat.",
    visual: <CapacityMock />,
  },
  {
    word: "Bayar QRIS",
    title: "Pembayaran dicek ke Midtrans",
    description: "Pembeli membayar lewat QRIS dari halaman status pesanannya sendiri. Status lunas diperiksa langsung ke Midtrans, bukan dari pengakuan pembeli. Saat ini memakai Midtrans Sandbox, jadi masih simulasi tanpa uang sungguhan.",
    visual: <BuyerStatusMock />,
  },
  {
    word: "Pesanan",
    title: "Semua pesanan di satu daftar",
    description: "Pesanan dari halaman preorder dan pesanan yang kamu catat manual masuk ke daftar yang sama. Proses tiap pesanan dari konfirmasi, produksi, siap, sampai diambil.",
    visual: <OrderStepsMock />,
  },
  {
    word: "Campaign AI",
    title: "Strategi saat target belum tercapai",
    description: "Jawab pertanyaan awal sekali, lalu AI mengusulkan strategi satu per satu. Usulan yang kamu pilih menjadi rencana kampanye lengkap dengan checklist harian dan caption. Angkanya dihitung sistem, keputusannya tetap di tanganmu.",
    visual: <AiMock />,
  },
  {
    word: "Hasil",
    title: "Lihat hasilnya dari angka sungguhan",
    description: "Ringkasan menampilkan progres target, pesanan yang perlu ditangani, dan unit yang harus diproduksi. Hasil kampanye dihitung dari pembayaran yang sudah terverifikasi.",
    visual: <SummaryMock />,
  },
];

/** Akhir kalimat judul yang berganti; semuanya hal yang memang dicatat aplikasi. Yang pertama juga dibaca pembaca layar. */
const heroEndings = [
  "sampai pesanan diambil.",
  "hingga pembayaran lunas.",
  "sampai kuota terpenuhi.",
  "hingga target tercapai.",
  "sampai produksi selesai.",
] as const;

type FlowStep = { title: string; points: string[]; visual: ReactNode };

const flowSteps: FlowStep[] = [
  { title: "Siapkan usaha dan produk", points: ["Isi profil usaha dan ketentuan pengambilan", "Tambah produk, harga jual, modal, dan sampai 5 foto"], visual: <ProductMock /> },
  { title: "Atur kapasitas produksi", points: ["Tentukan berapa unit yang sanggup dibuat per tanggal", "Atur batas pemesanan dan jam terakhir pengambilan"], visual: <CapacityMock /> },
  {
    title: "Simpan draf, terbitkan, bagikan",
    points: ["Pilih produk dan jadwal, isi target dan kuota, simpan sebagai draf", "Terbitkan, lalu bagikan tautannya ke WhatsApp, Instagram, atau grup pelanggan"],
    visual: <ShareMock />,
  },
  {
    title: "Pembeli memesan dan membayar QRIS",
    points: ["Pembeli mengisi jumlah dan kontak tanpa membuat akun", "Email menunggu pembayaran dan pembayaran berhasil terkirim otomatis, beserta tautan status pesanan"],
    visual: <EmailMock />,
  },
  {
    title: "Target belum tercapai? Minta strategi AI",
    points: ["Jawab pertanyaan awal sekali, jawabanmu diingat", "Pilih usulan, jadikan rencana, lalu jalankan checklist dan caption-nya"],
    visual: <AiMock />,
  },
  {
    title: "Proses pesanan dan lihat hasilnya",
    points: ["Konfirmasi, produksi, tandai siap, sampai pesanan diambil", "Catat pesanan dari luar aplikasi secara manual", "Pantau progres target dan hasil kampanye"],
    visual: <OrderStepsMock />,
  },
];

/**
 * Panah coretan tangan antarlangkah: turun dari atas, melengkung panjang, lalu menukik ke langkah berikutnya dengan kepala
 * panah berlekuk. Tergambar mengikuti gulir (--v dari ScrollDrawEffects). `flip` membalik arah sesuai susunan zig-zag.
 */
function FlowArrow({ flip }: { flip: boolean }) {
  return (
    <div className={styles.flowArrow} data-flip={flip} data-scroll-draw="arrow" aria-hidden="true">
      <svg viewBox="0 0 520 230" fill="none">
        <path className={styles.arrowLine} pathLength={1} d="M74 2C72 40 76 78 124 92C168 105 220 88 274 86C330 84 380 98 410 140C428 165 440 190 450 214" />
        <path className={styles.arrowHead} pathLength={1} d="M462 168C454 186 450 200 450 214C434 208 414 200 402 192C408 194 424 204 448 213" />
      </svg>
    </div>
  );
}

export function LandingPage() {
  return (
    <div className={styles.landing} id="beranda">
      <a className="skip-link" href="#konten-utama">Langsung ke konten</a>
      <header className={styles.header}>
        <div className={`ui-container ${styles.headerInner}`}>
          <Brand />
          <nav className={styles.desktopNav} aria-label="Navigasi utama">
            {landingNavigation.map((item) => <a href={item.href} key={item.href}>{item.label}</a>)}
          </nav>
          <div className={styles.authActions}>
            <ButtonLink className={styles.headerSecondary} variant="secondary" href={authLinks.signIn.href}>{authLinks.signIn.label}</ButtonLink>
            <ButtonLink className={styles.headerCta} href={authLinks.signUp.href}>{authLinks.signUp.label}</ButtonLink>
          </div>
          <MobileNavigation />
        </div>
      </header>

      <main id="konten-utama" tabIndex={-1}>
        <section className={styles.hero} aria-labelledby="hero-title">
          <div className={`ui-container ${styles.heroCopy}`}>
            <p className={styles.eyebrow}>Platform preorder untuk UMKM</p>
            <h1 id="hero-title">
              Jalankan preorder dari pesanan pertama <span className="sr-only">{heroEndings[0]}</span>
              <RotatingPhrase phrases={heroEndings} />
            </h1>
            <p className={styles.heroDescription}>
              juarasatu membantu kamu mengatur kapasitas produksi, membagikan halaman pesanan, menerima pembayaran QRIS, dan
              mendapat strategi promosi dari AI saat target belum tercapai.
            </p>
            <div className={styles.heroActions}>
              <ButtonLink className={styles.primaryAction} href={authLinks.signUp.href}>Daftar sekarang<Icon name="arrow-right" /></ButtonLink>
              <ButtonLink className={styles.secondaryAction} variant="secondary" href="#cara-pakai">Lihat cara pakai</ButtonLink>
            </div>
            <p className={styles.previewNotice}>Pembayaran memakai Midtrans Sandbox: simulasi, tanpa uang sungguhan.</p>
          </div>
          <div className={`ui-container ${styles.heroVisual}`} data-scroll-draw="card">
            <SummaryMock />
            <p className={styles.visualCaption}>Contoh tampilan Ringkasan dengan data contoh.</p>
          </div>
        </section>

        <UnifyScene />

        <FeatureScroller features={features} />

        <section className={styles.flow} id="cara-pakai" aria-labelledby="flow-title">
          <div className="ui-container">
            <div className={styles.flowIntro}>
              <p className={styles.eyebrow}>Cara pakai</p>
              <h2 id="flow-title">Enam langkah dari dasbor sampai pesanan diambil.</h2>
            </div>
            <ol className={styles.flowList}>
              {flowSteps.map((step, index) => (
                <li key={step.title} className={styles.flowItem}>
                  <div className={styles.flowStep} data-side={index % 2 === 0 ? "start" : "end"} data-scroll-draw="step">
                    <div className={styles.flowCopy}>
                      <span className={styles.stepTag}>Langkah {index + 1}</span>
                      <h3>{step.title}</h3>
                      <ul>{step.points.map((point) => <li key={point}>{point}</li>)}</ul>
                    </div>
                    <div className={styles.flowVisual}>{step.visual}</div>
                  </div>
                  {index < flowSteps.length - 1 && <FlowArrow flip={index % 2 === 1} />}
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className={styles.closing} aria-labelledby="closing-title">
          <div className={`ui-container ${styles.closingInner}`}>
            <h2 id="closing-title">Siap membuka preorder pertamamu?</h2>
            <p>Daftar, siapkan produk, lalu bagikan tautan pesananmu hari ini.</p>
            <div className={styles.closingActions}>
              <ButtonLink className={styles.inverseAction} variant="inverse" href={authLinks.signUp.href}>Daftar sekarang</ButtonLink>
              <ButtonLink className={styles.closingSecondary} variant="secondary" href={authLinks.signIn.href}>Masuk</ButtonLink>
            </div>
          </div>
        </section>
      </main>

      <PlatformFooter />
      <ScrollDrawEffects />
    </div>
  );
}
