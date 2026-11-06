import { Brand } from "@/components/brand";
import { ButtonLink } from "@/components/ui/button-link";
import { Icon } from "@/components/ui/icon";
import { authLinks, landingNavigation } from "@/config/site";
import { demo, initialAvailable, initialTargetGap } from "./demo-data";
import { MobileNavigation } from "./mobile-navigation";
import { OfferBreakdown, PreorderPhone, ProductPreview } from "./product-preview";
import { ResultPreview } from "./result-preview";
import { PlatformFooter } from "./platform-footer";
import styles from "./landing.module.css";

const questions = [
  {
    question: "Bisa buka preorder tanpa membuat promosi?",
    answer: "Bisa. Preorder dirancang untuk berjalan sendiri. Kamu bisa menambahkan promosi pada preorder yang sama saat membutuhkannya, tanpa harus memakai AI terlebih dahulu.",
  },
  {
    question: "Satu produk berarti pembeli hanya boleh pesan satu unit?",
    answer: "Satu produk berarti satu jenis atau SKU pada setiap preorder. Pembeli tetap bisa memesan beberapa unit, selama jumlahnya tidak melebihi kapasitas yang tersedia. Pilihan ukuran, warna, atau produk lain dalam satu pesanan belum termasuk MVP.",
  },
  {
    question: "Kenapa sisa target berbeda dengan kapasitas tersedia?",
    answer: `Di contoh ini, targetnya ${demo.target} unit dan ${demo.initialPaidUnits} sudah dibayar. Sisa targetnya ${initialTargetGap} unit. Karena ${demo.initialHeldUnits} slot masih menunggu pembayaran, yang bisa dipesan pelanggan baru hanya ${initialAvailable} unit. Target adalah sasaran penjualan, bukan minimum produksi. Pesanan valid tetap dipenuhi meskipun target belum tercapai.`,
  },
  {
    question: "Siapa yang mendapat harga promosi?",
    answer: "Saat promosi aktif, semua pemesanan baru pada preorder tersebut mendapat harga promosi, termasuk pembeli tanpa tautan kampanye. Harga pesanan yang sudah dibuat sebelumnya tetap mengikuti harga saat pemesanan. Tautan kampanye membantu mencatat asal pesanan.",
  },
  {
    question: "Apakah sudah bisa dipakai untuk menerima pesanan?",
    answer: "Belum. Halaman ini adalah pratinjau produk dengan data contoh, bukan layanan transaksi yang sudah aktif. Pemesanan, AI, pembayaran, dan email belum terhubung. Simulasi pembayaran direncanakan memakai Midtrans Sandbox, tanpa uang nyata.",
  },
];

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
            <p className={styles.eyebrow}>Juara Satu untuk usaha preorder</p>
            <h1 id="hero-title">Kelola preorder dan promosi <span>sesuai kapasitas usahamu.</span></h1>
            <p className={styles.heroDescription}>Bagikan halaman pesanan ke pelanggan. Rencanakan penawaran dengan melihat sisa kuota dan biaya produk.</p>
            <ButtonLink className={styles.primaryAction} href={authLinks.signUp.href}>Daftar sekarang<Icon name="arrow-right" /></ButtonLink>
            <a className={styles.heroExampleLink} href="#contoh-penggunaan">Lihat contoh preorder</a>
            <p className={styles.previewNotice}>Pratinjau produk · data contoh · belum menerima transaksi</p>
          </div>
          <ProductPreview />
        </section>

        <section className={styles.offerSection} id="cara-kerja" tabIndex={-1} aria-labelledby="offer-title">
          <div className={styles.chapterPanel}>
            <div className={`ui-container ${styles.chapterLayout}`}>
              <div className={styles.chapterCopy}>
                <p className={styles.chapterLabel}>02 / Sebelum membagikan promosi</p>
                <h2 id="offer-title">Hitung penawaran sebelum dibagikan.</h2>
                <p>Dua reservasi yang belum dibayar dilepas. Kini ada ruang untuk menerima {demo.campaignTargetUnits} unit lagi. Pemilik usaha ingin meninjau diskon, sambil melihat biaya per produknya.</p>
                <div className={styles.ownerNote}>
                  <strong>AI menyiapkan pilihan. Kamu meninjau rencananya.</strong>
                  <p>Ide promosi dan draf caption bisa dibantu AI. Harga, biaya, dan kapasitas tetap menjadi dasar pertimbanganmu.</p>
                </div>
                <ol className={styles.approvalSteps} id="persetujuan-promosi" tabIndex={-1} aria-label="Langkah persetujuan kampanye">
                  <li>Pilih ide</li><li>Setujui rencana</li><li>Terbitkan</li>
                </ol>
                <p className={styles.approvalNote}>Memilih ide belum menerbitkan promosi.</p>
              </div>
              <OfferBreakdown />
            </div>
          </div>
        </section>

        <section className={styles.resultSection} id="contoh-hasil" tabIndex={-1} aria-labelledby="result-title">
          <div className={`ui-container ${styles.resultIntro}`}>
            <div><p className={styles.chapterLabel}>03 / Setelah promosi berjalan</p><h2 id="result-title">Pisahkan hasil preorder dan hasil promosi.</h2></div>
            <p>Pesanan selama promosi masuk ke laporan preorder yang sama. Lihat gambaran keseluruhannya, lalu buka rincian untuk memahami biaya dan asal pesanannya.</p>
          </div>
          <ResultPreview />
        </section>

        <section className={styles.benefitSection} id="manfaat" tabIndex={-1} aria-labelledby="benefit-title">
          <div className="ui-container">
            <div className={styles.benefitIntro}><p className={styles.eyebrow}>Dirancang untuk operasional usaha</p><h2 id="benefit-title">Dari pelanggan memesan sampai produk diserahkan.</h2></div>
            <dl className={styles.benefits}>
              <div><dt>Satu produk, beberapa unit</dt><dd>Pelanggan memilih jumlah yang dibutuhkan pada satu preorder, tanpa membuat akun.</dd></div>
              <div><dt>Pembayaran dan pengambilan</dt><dd>Pesanan yang sudah dibayar tetap punya proses konfirmasi, produksi, dan penyerahan sendiri.</dd></div>
              <div><dt>Promosi saat dibutuhkan</dt><dd>Preorder bisa berjalan tanpa kampanye. Tambahkan rencana promosi ketika ada kebutuhan.</dd></div>
            </dl>
          </div>
        </section>

        <section className={styles.faqSection} id="pertanyaan-umum" tabIndex={-1} aria-labelledby="faq-title">
          <div className={`ui-container ${styles.faqInner}`}>
            <div><p className={styles.eyebrow}>Sebelum mulai</p><h2 id="faq-title">Yang mungkin ingin kamu tanyakan.</h2><p className={styles.faqLead}>Tentang jumlah pesanan, target, dan cara promosi bekerja.</p></div>
            <div className={styles.faqList}>
              {questions.map((item) => (
                <details className={styles.faqItem} key={item.question}>
                  <summary>{item.question}<span className={styles.disclosureGlyph} aria-hidden="true" /></summary>
                  <p>{item.answer}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className={styles.closing} aria-labelledby="closing-title">
          <div className={`ui-container ${styles.closingInner}`}>
            <div className={styles.closingCopy}>
              <h2 id="closing-title">Mulai dari preorder yang bisa kamu penuhi.</h2>
              <div className={styles.closingActions}>
                <ButtonLink className={styles.inverseAction} variant="inverse" href={authLinks.signUp.href}>Daftar sekarang</ButtonLink>
                <ButtonLink className={styles.closingSecondary} variant="secondary" href="#cara-kerja">Cara kerja</ButtonLink>
              </div>
            </div>
            <div className={styles.closingVisual} aria-hidden="true">
              <PreorderPhone titleId="closing-preorder-title" />
            </div>
          </div>
        </section>
      </main>

      <PlatformFooter />
    </div>
  );
}
