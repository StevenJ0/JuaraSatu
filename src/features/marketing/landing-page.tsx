import { Brand } from "@/components/brand";
import { ButtonLink } from "@/components/ui/button-link";
import { Icon } from "@/components/ui/icon";
import { landingNavigation, site } from "@/config/site";
import { MobileNavigation } from "./mobile-navigation";
import { demo, estimatedContribution, initialAvailable, offerPrice, rupiah, unitContribution } from "./demo-data";
import { OfferBreakdown, ProductPreview } from "./product-preview";
import { ResultPreview } from "./result-preview";
import styles from "./landing.module.css";

const problems = [
  {
    title: "Pesanan tersebar di chat",
    description: "Jumlah kotak, nama pemesan, dan tanggal pengambilan perlu direkap satu per satu. Satu pesan terlewat bisa membuat catatan berbeda.",
    outcome: "Kebutuhan: satu rekap pesanan.",
    icon: "notes",
  },
  {
    title: "Promo dulu, hitungan belakangan",
    description: "Diskon sudah dibagikan, tetapi biaya per kotak dan ruang produksi belum diperiksa. Pesanan tambahan belum tentu bisa dikerjakan.",
    outcome: "Kebutuhan: biaya dan kuota ikut dihitung.",
    icon: "box",
  },
  {
    title: "Hasil berhenti di jumlah pesanan",
    description: "Pesanan terlihat ramai, tetapi berapa yang sudah diserahkan? Berapa biaya promosinya? Angka itu perlu dibaca bersama.",
    outcome: "Kebutuhan: hasil yang bisa ditelusuri.",
    icon: "chart",
  },
] as const;

const workflow = [
  { title: "Kenali ruang dapur", description: "Atur produk, harga, biaya variabel, dan kapasitas per tanggal. Pesanan lama ikut mengurangi ruang yang tersedia.", detail: "Produk, biaya & kapasitas" },
  { title: "Tinjau pilihan promosi", description: "Bandingkan saran strategi, harga penawaran, kontribusi, dan kuotanya. Kamu meninjau dan menyetujui rencana sebelum dibagikan.", detail: "Strategi, simulasi & persetujuan" },
  { title: "Bagikan & kelola preorder", description: "Dalam rancangan produk, tautan preorder dibagikan secara manual. Kelola pembayaran sandbox, produksi, sampai pesanan diserahkan.", detail: "Preorder & pemenuhan" },
  { title: "Baca hasilnya", description: "Bandingkan pesanan yang selesai dengan target. Periksa biaya tercatat dan estimasi kontribusi sebagai bekal rencana berikutnya.", detail: "Target, biaya & evaluasi" },
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
          <ButtonLink className={styles.headerCta} href="#contoh-penggunaan">Lihat contoh alur<Icon name="arrow-up-right" /></ButtonLink>
          <MobileNavigation />
        </div>
      </header>
      <main id="konten-utama" tabIndex={-1}>
        <section className={`ui-container ${styles.hero}`} aria-labelledby="hero-title">
          <div className={styles.heroCopy}>
            <p className={styles.audience}><span aria-hidden="true" />Untuk usaha makanan berbasis preorder</p>
            <h1 id="hero-title">Rencanakan promosi sesuai kapasitas.</h1>
            <p className={styles.heroLead}>Kelola preorder sampai hasilnya terbaca.</p>
            <p className={styles.heroDescription}>{site.name} membantu pemilik usaha brownies, kue, dan roti menghubungkan biaya, ruang dapur, promosi, dan pesanan dalam satu alur.</p>
            <div className={styles.heroActions}>
              <ButtonLink href="#contoh-penggunaan">Lihat contoh penggunaan<Icon name="arrow-right" /></ButtonLink>
              <a className={styles.textLink} href="#cara-kerja">Pelajari cara kerja</a>
            </div>
            <p className={styles.previewNotice}>Jelajahi pratinjau. Fitur operasional belum terhubung.</p>
          </div>
          <ProductPreview />
        </section>

        <section className={styles.problemSection} aria-labelledby="problem-title">
          <div className="ui-container">
            <div className={styles.sectionIntro}>
              <div><p className={styles.sectionLabel}>Masalah yang ingin dibantu</p><h2 id="problem-title">Pesanan masuk.<br />Catatan ikut siap?</h2></div>
              <p>Bayangkan membuka preorder brownies akhir pekan. Di antara pesan masuk dan oven yang terbatas, keputusan kecil saling berkaitan.</p>
            </div>
            <div className={styles.problemColumns}>
              {problems.map((problem) => (
                <article className={styles.problem} key={problem.title}>
                  <Icon name={problem.icon} />
                  <h3>{problem.title}</h3>
                  <p>{problem.description}</p>
                  <span>{problem.outcome}</span>
                </article>
              ))}
            </div>
            <p className={styles.hypothesisNote}>Situasi di atas adalah ilustrasi masalah dalam PRD, belum merupakan temuan wawancara pengguna.</p>
          </div>
        </section>

        <section className={`ui-container ${styles.workflowSection}`} id="cara-kerja" tabIndex={-1} aria-labelledby="workflow-title">
          <div className={styles.centeredIntro}>
            <p className={styles.sectionLabel}>Cara kerja yang direncanakan</p>
            <h2 id="workflow-title">Dari rencana, sampai hasil.</h2>
            <p>Bukan keputusan yang terpisah. Setiap tahap membawa kapasitas, biaya, dan tujuan yang sama.</p>
          </div>
          <ol className={styles.workflow}>
            {workflow.map((step, index) => (
              <li key={step.title}>
                <span className={styles.stepNumber} aria-hidden="true">{index + 1}</span>
                <p className={styles.stepDetail}>{step.detail}</p>
                <h3>{step.title}</h3>
                <p>{step.description}</p>
              </li>
            ))}
          </ol>
          <div className={styles.ownerControl}>
            <span className={styles.ownerIcon}><Icon name="check" /></span>
            <div><strong>AI menyarankan. Pemilik yang menyetujui.</strong><p>AI membantu menyusun pilihan, alasan, dan draf caption. Hitungan uang serta kapasitas dilakukan kode. Rencana eksekusi tetap dijalankan pemilik.</p></div>
          </div>
        </section>

        <section className={styles.exampleSection} id="contoh-penggunaan" tabIndex={-1} aria-labelledby="example-title">
          <div className={`ui-container ${styles.exampleLayout}`}>
            <div className={styles.exampleCopy}>
              <p className={styles.sectionLabel}>Contoh penggunaan / kondisi awal</p>
              <h2 id="example-title">Sebelum dibagikan,<br />hitung dulu.</h2>
              <p>Dapur brownies mampu membuat {demo.capacity} kotak pada Sabtu. Pesanan lama sudah memakai {demo.previouslyAllocated} kotak. Artinya, rencana promosi memakai sisa {initialAvailable} kotak.</p>
              <p>Untuk opsi diskon {demo.discountPercent}%, harga {rupiah(demo.basePrice)} menjadi {rupiah(offerPrice)}. Setelah biaya variabel {rupiah(demo.variableCost)}, kontribusinya {rupiah(unitContribution)} per kotak.</p>
              <div className={styles.exampleTakeaway}><Icon name="check" /><p>Penawaran ditinjau bersama biaya dan ruang produksi, sebelum pemilik menyetujuinya.</p></div>
              <a className={styles.textLink} href="#contoh-hasil">Lanjut ke contoh hasil<Icon name="arrow-right" /></a>
            </div>
            <OfferBreakdown />
          </div>
        </section>

        <section className={`ui-container ${styles.resultSection}`} id="contoh-hasil" tabIndex={-1} aria-labelledby="result-title">
          <ResultPreview />
          <div className={styles.resultCopy}>
            <p className={styles.sectionLabel}>Contoh penggunaan / kondisi akhir</p>
            <h2 id="result-title">Hasilnya bisa<br />ditelusuri.</h2>
            <p>Dari target {demo.target} kotak, {demo.fulfilled} selesai diserahkan. Contoh hasil akhir mempertemukan nilai penjualan simulasi dengan biaya produk dan promosi yang tercatat.</p>
            <div className={styles.resultInsight}><Icon name="chart" /><div><strong>Angkanya terbaca. Kesimpulannya tetap hati-hati.</strong><p>Estimasi kontribusi {rupiah(estimatedContribution)} belum mencakup biaya lain. Data contoh ini belum membuktikan bahwa diskon menyebabkan tambahan penjualan.</p></div></div>
            <p className={styles.resultContext}>Ini kelanjutan ilustrasi Brownies Sabtu, bukan laporan usaha atau transaksi nyata.</p>
          </div>
        </section>

        <section className={styles.closing} aria-labelledby="closing-title">
          <div className={`ui-container ${styles.closingInner}`}>
            <div><p className={styles.closingLabel}>Satu alur untuk rencana berikutnya</p><h2 id="closing-title">Mulai dari yang<br />bisa dapurmu kerjakan.</h2><p>Lihat bagaimana biaya dan kapasitas memberi arah pada promosi, preorder, dan evaluasinya.</p></div>
            <div className={styles.closingAction}><ButtonLink variant="inverse" href="#contoh-penggunaan">Lihat contoh penggunaan<Icon name="arrow-up-right" /></ButtonLink><span>Pratinjau berlabel data sintetis.</span></div>
          </div>
        </section>
      </main>
      <footer className={`ui-container ${styles.footer}`}>
        <div className={styles.footerTop}><Brand /><p>Rancangan platform preorder untuk UMKM makanan.<br />Dikembangkan untuk GTNIC 2026, Web Development.</p><a className={styles.textLink} href="#beranda">Kembali ke atas<Icon name="arrow-up-right" /></a></div>
        <div className={styles.footerNote}><p><strong>Pembayaran demo direncanakan melalui satu akun Midtrans Sandbox tim, tanpa uang nyata.</strong> Halaman ini belum terhubung ke AI, preorder, atau pembayaran.</p><span>{site.name} adalah nama sementara.</span></div>
      </footer>
    </div>
  );
}
