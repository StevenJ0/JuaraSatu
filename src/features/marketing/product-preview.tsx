import { Icon } from "@/components/ui/icon";
import { demo, initialAvailable, offerPrice, rupiah, unitContribution } from "./demo-data";
import styles from "./landing.module.css";

export function ProductPreview() {
  return (
    <figure className={styles.productStage} aria-label="Ilustrasi hubungan kapasitas dan penawaran brownies">
      <figcaption className={styles.stageCaption}>
        <span className={styles.previewDot} aria-hidden="true" />
        Contoh data sintetis
        <span>Pratinjau platform</span>
      </figcaption>
      <div className={styles.productWindow}>
        <div className={styles.windowHeader}>
          <div className={styles.windowMark}><Icon name="box" /></div>
          <div><strong>{demo.campaign}</strong><span>Rencana produksi & promosi</span></div>
          <span className={styles.draftLabel}>Ilustrasi</span>
        </div>
        <div className={styles.capacityPanel}>
          <div className={styles.capacityTitle}>
            <div><span>Sisa kapasitas awal</span><strong>{initialAvailable}<small>kotak</small></strong></div>
            <p>dari {demo.capacity} kotak<br />kapasitas Sabtu</p>
          </div>
          <div className={styles.capacityGrid} role="img" aria-label={`${demo.capacity} petak, masing-masing 1 kotak. ${demo.previouslyAllocated} kotak pesanan lama dan ${initialAvailable} kotak tersedia.`}>
            {Array.from({ length: demo.capacity }, (_, index) => (
              <span className={index < demo.previouslyAllocated ? styles.allocatedSlot : styles.availableSlot} key={index} />
            ))}
          </div>
          <div className={styles.capacityLegend}>
            <span><i className={styles.allocatedSlot} />{demo.previouslyAllocated} kotak pesanan lama</span>
            <span><i className={styles.availableSlot} />{initialAvailable} kotak tersedia</span>
          </div>
        </div>
        <div className={styles.offerPanel}>
          <div className={styles.offerHeading}><span>Opsi penawaran</span><span className={styles.discountLabel}>Diskon {demo.discountPercent}%</span></div>
          <h3>{demo.product}</h3>
          <div className={styles.offerPrice}><strong>{rupiah(offerPrice)}</strong><span>/ kotak</span><del>{rupiah(demo.basePrice)}</del></div>
          <dl className={styles.offerNumbers}>
            <div><dt>Kontribusi per kotak</dt><dd>{rupiah(unitContribution)}</dd></div>
            <div><dt>Kuota yang direncanakan</dt><dd>{initialAvailable} kotak</dd></div>
          </dl>
        </div>
        <div className={styles.reviewNote}><Icon name="check" /><p>Pemilik meninjau biaya dan kuota sebelum menyetujui penawaran.</p></div>
      </div>
      <p className={styles.stageFootnote}>Kondisi awal. Belum ada kampanye yang diterbitkan.</p>
    </figure>
  );
}

export function OfferBreakdown() {
  const rows = [
    { label: "Harga normal", value: rupiah(demo.basePrice) },
    { label: `Diskon ${demo.discountPercent}%`, value: `−${rupiah(demo.basePrice - offerPrice)}` },
    { label: "Harga penawaran", value: rupiah(offerPrice), emphasized: true },
    { label: "Biaya variabel per kotak", value: `−${rupiah(demo.variableCost)}` },
    { label: "Kontribusi per kotak", value: rupiah(unitContribution), emphasized: true },
  ];

  return (
    <figure className={styles.breakdown}>
      <figcaption><span>Contoh data sintetis</span><strong>{demo.campaign} / kondisi awal</strong></figcaption>
      <div className={styles.breakdownSummary}><Icon name="box" /><p><strong>{demo.capacity} kotak kapasitas − {demo.previouslyAllocated} kotak pesanan lama</strong><span>{initialAvailable} kotak tersedia untuk rencana promosi.</span></p></div>
      <dl className={styles.priceRows}>
        {rows.map((row) => (
          <div className={row.emphasized ? styles.emphasizedRow : undefined} key={row.label}><dt>{row.label}</dt><dd>{row.value}</dd></div>
        ))}
      </dl>
      <p className={styles.breakdownNote}>Kuota promosi memakai sisa kapasitas yang sama. Diskon mengubah kontribusi per kotak; belum memprediksi jumlah pesanan.</p>
    </figure>
  );
}
