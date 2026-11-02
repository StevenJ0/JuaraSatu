import { Brand } from "@/components/brand";
import { ButtonLink } from "@/components/ui/button-link";
import { Icon } from "@/components/ui/icon";
import { landingNavigation, site } from "@/config/site";
import { MobileNavigation } from "./mobile-navigation";
import { campaignContribution, campaignStartAvailable, campaignUnattributedUnits, demo, discountPercent, finalPaidUnits, initialAvailable, initialTargetGap, offerPrice, rupiah, unitContribution } from "./demo-data";
import { OfferBreakdown, ProductPreview } from "./product-preview";
import { ResultPreview } from "./result-preview";
import styles from "./landing.module.css";

const problems = [
  {
    title: "Pesanan masuk, rekap tertinggal",
    description: "Nama pemesan, jumlah unit, dan status pembayaran tersebar di chat. Pemilik harus mencocokkannya sebelum menyiapkan pesanan.",
    outcome: "Satu alur pesanan sampai pemenuhan.",
    icon: "notes",
  },
  {
    title: "Target kurang, slot belum jelas",
    description: "Selisih target belum tentu sama dengan slot yang bisa dijual. Sebagian slot mungkin sedang menunggu pembayaran.",
    outcome: "Bedakan target, slot ditahan, dan ketersediaan.",
    icon: "box",
  },
  {
    title: "Promo ramai, hasil sulit dibaca",
    description: "Tambahan pesanan selama promosi belum tentu berasal dari tautannya. Diskon, biaya produk, dan biaya promosi juga perlu dihitung bersama.",
    outcome: "Laporan preorder dan kampanye punya lingkup jelas.",
    icon: "chart",
  },
] as const;

const workflow = [
  { title: "Buka preorder", description: "Tentukan produk, harga, biaya, kuota, dan tanggal pemenuhan. Preorder dapat berjalan tanpa AI atau kampanye.", detail: "Produk, kapasitas & target" },
  { title: "Kelola pesanan", description: "Bagikan tautan pemesanan. Pantau pembayaran, email konfirmasi, produksi, dan penyerahan dengan status yang terpisah.", detail: "Pesanan, pembayaran & pemenuhan" },
  { title: "Promosikan saat perlu", description: "Tinjau saran AI dan simulasi biaya. Pilih proposal, setujui blueprint, lalu terbitkan kampanye pada preorder yang sama.", detail: "Rencana, persetujuan & publikasi" },
  { title: "Pahami dua laporan", description: "Baca progres seluruh preorder dan hasil periode kampanye. Evaluasi yang tersimpan menjadi bekal rencana usaha berikutnya.", detail: "Angka, evaluasi & pengalaman" },
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
            <p className={styles.audience}><span aria-hidden="true" />Untuk UMKM produk standar berbasis preorder</p>
            <h1 id="hero-title">Buka preorder. Promosi saat perlu.</h1>
            <p className={styles.heroLead}>Pesanan tertata. Promosi punya arah.</p>
            <p className={styles.heroDescription}>{site.name} menghubungkan kuota, pesanan, dan pembayaran. Saat ingin menambah penjualan, rencanakan promosi sesuai biaya dan slot yang tersedia.</p>
            <div className={styles.heroActions}>
              <ButtonLink href="#contoh-penggunaan">Lihat contoh penggunaan<Icon name="arrow-right" /></ButtonLink>
              <a className={styles.textLink} href="#cara-kerja">Pelajari cara kerja</a>
            </div>
            <p className={styles.previewNotice}>Pratinjau dengan data sintetis. Fitur operasional belum terhubung.</p>
          </div>
          <ProductPreview />
        </section>

        <section className={styles.problemSection} aria-labelledby="problem-title">
          <div className="ui-container">
            <div className={styles.sectionIntro}>
              <div><p className={styles.sectionLabel}>Masalah yang ingin dibantu</p><h2 id="problem-title">Dari pesanan masuk,<br />sampai keputusan berikutnya.</h2></div>
              <p>Untuk usaha kaos, merchandise, dan produk standar lainnya, pesanan, kuota, serta promosi perlu bertemu dalam catatan yang sama.</p>
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
            <h2 id="workflow-title">Preorder dulu. Kampanye menyusul.</h2>
            <p>Mulai menerima pesanan tanpa menunggu rencana promosi. Kampanye membantu preorder yang sudah ada, dengan keputusan tetap di tangan pemilik.</p>
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
            <div><strong>AI menyarankan. Pemilik yang menyetujui.</strong><p>AI membantu menyusun strategi, alasan, dan draf caption. Harga, kuota, dan laporan dihitung kode. Memilih proposal, menyetujui rencana, dan menerbitkan kampanye adalah langkah yang terpisah.</p></div>
          </div>
        </section>

        <section className={styles.exampleSection} id="contoh-penggunaan" tabIndex={-1} aria-labelledby="example-title">
          <div className={`ui-container ${styles.exampleLayout}`}>
            <div className={styles.exampleCopy}>
              <p className={styles.sectionLabel}>Contoh penggunaan / rencana promosi</p>
              <h2 id="example-title">Target belum penuh.<br />Perlu promo seperti apa?</h2>
              <p>Preorder kaos memiliki target dan kuota {demo.target} unit. Sudah {demo.initialPaidUnits} unit dibayar, tetapi {demo.initialHeldUnits} slot masih ditahan. Selisih target {initialTargetGap} unit, sedangkan yang bisa dipesan sekarang {initialAvailable} unit.</p>
              <p>Dalam contoh ini, {demo.releasedHeldUnits} slot yang belum dibayar dilepas sebelum promosi, sehingga tersedia {campaignStartAvailable} unit. Opsi diskon {discountPercent}% mengubah harga {rupiah(demo.basePrice)} menjadi {rupiah(offerPrice)}; kontribusinya {rupiah(unitContribution)} per unit setelah biaya variabel {rupiah(demo.variableCost)}.</p>
              <div className={styles.exampleTakeaway}><Icon name="check" /><p>Promosi memakai preorder yang sama. Pembeli dari tautan kampanye maupun tautan biasa mendapat diskon aktif yang sama.</p></div>
              <a className={styles.textLink} href="#contoh-hasil">Lanjut ke contoh hasil<Icon name="arrow-right" /></a>
            </div>
            <OfferBreakdown />
          </div>
        </section>

        <section className={`ui-container ${styles.resultSection}`} id="contoh-hasil" tabIndex={-1} aria-labelledby="result-title">
          <ResultPreview />
          <div className={styles.resultCopy}>
            <p className={styles.sectionLabel}>Contoh penggunaan / hasil akhir</p>
            <h2 id="result-title">Satu usaha.<br />Dua sudut pandang.</h2>
            <p>Selama kampanye ada {demo.campaignPaidUnits} unit tambahan dibayar: {demo.campaignAttributedUnits} melalui tautan kampanye dan {campaignUnattributedUnits} tanpa atribusi tautan. Semuanya mendapat diskon aktif. Total preorder menjadi {finalPaidUnits} dari target {demo.target} unit.</p>
            <div className={styles.resultInsight}><Icon name="chart" /><div><strong>Tambahan selama promosi bukan bukti sebab-akibat.</strong><p>Kontribusi periode contoh adalah {rupiah(campaignContribution)} setelah biaya produksi dan promosi tercatat. Angka ini belum mencakup biaya lain dan tidak membuktikan diskon menyebabkan tambahan penjualan.</p></div></div>
            <p className={styles.resultContext}>Snapshot akhir mengasumsikan semua pesanan valid sudah diserahkan dan biaya contoh lengkap. Ini ilustrasi, bukan laporan usaha nyata.</p>
          </div>
        </section>

        <section className={styles.closing} aria-labelledby="closing-title">
          <div className={`ui-container ${styles.closingInner}`}>
            <div><p className={styles.closingLabel}>Buka preorder. Rencanakan promosi. Pahami hasilnya.</p><h2 id="closing-title">Mulai dari preorder<br />yang bisa kamu kelola.</h2><p>Lihat bagaimana pesanan, biaya, dan slot tersedia memberi arah pada keputusan promosi berikutnya.</p></div>
            <div className={styles.closingAction}><ButtonLink variant="inverse" href="#contoh-penggunaan">Lihat contoh penggunaan<Icon name="arrow-up-right" /></ButtonLink><span>Pratinjau berlabel data sintetis.</span></div>
          </div>
        </section>
      </main>
      <footer className={`ui-container ${styles.footer}`}>
        <div className={styles.footerTop}><Brand /><p>Rancangan platform preorder untuk UMKM produk standar.<br />Dikembangkan untuk GTNIC 2026, Web Development.</p><a className={styles.textLink} href="#beranda">Kembali ke atas<Icon name="arrow-up-right" /></a></div>
        <div className={styles.footerNote}><p><strong>Pembayaran demo direncanakan melalui satu akun Midtrans Sandbox tim, tanpa uang nyata.</strong> Halaman ini belum terhubung ke database, AI, pemesanan, pembayaran, atau email.</p><span>{site.name} · pratinjau pengembangan</span></div>
      </footer>
    </div>
  );
}
