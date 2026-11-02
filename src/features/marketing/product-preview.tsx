import { Icon } from "@/components/ui/icon";
import { campaignStartAvailable, demo, discountPercent, initialAvailable, initialTargetGap, offerPrice, rupiah, unitContribution, unitDiscount } from "./demo-data";
import styles from "./landing.module.css";

export function ProductPreview() {
  return (
    <figure className={styles.productStage} aria-label="Ilustrasi preorder mandiri: target dibayar, slot ditahan, dan slot tersedia">
      <figcaption className={styles.stageCaption}>
        <span className={styles.previewDot} aria-hidden="true" />
        Contoh data sintetis
        <span>Pratinjau platform</span>
      </figcaption>
      <div className={styles.productWindow}>
        <div className={styles.windowHeader}>
          <div className={styles.windowMark}><Icon name="box" /></div>
          <div><strong>{demo.preorder}</strong><span>Satu produk · satu tanggal pemenuhan</span></div>
        </div>
        <div className={styles.capacityPanel}>
          <div className={styles.capacityTitle}>
            <div><span>Unit sudah dibayar · simulasi</span><strong>{demo.initialPaidUnits}<small>/ {demo.target} target</small></strong></div>
            <p>Preorder berjalan<br />tanpa kampanye</p>
          </div>
          <div className={styles.capacityGrid} role="img" aria-label={`${demo.capacity} slot: ${demo.initialPaidUnits} sudah dibayar, ${demo.initialHeldUnits} ditahan sementara, ${initialAvailable} tersedia.`}>
            {Array.from({ length: demo.capacity }, (_, index) => (
              <span aria-hidden="true" className={index < demo.initialPaidUnits ? styles.allocatedSlot : index < demo.initialPaidUnits + demo.initialHeldUnits ? styles.heldSlot : styles.availableSlot} key={index} />
            ))}
          </div>
          <div className={styles.capacityLegend}>
            <span><i className={styles.allocatedSlot} aria-hidden="true" />{demo.initialPaidUnits} dibayar</span>
            <span><i className={styles.heldSlot} aria-hidden="true" />{demo.initialHeldUnits} ditahan</span>
            <span><i className={styles.availableSlot} aria-hidden="true" />{initialAvailable} tersedia</span>
          </div>
          <dl className={styles.availabilitySummary}>
            <div><dt>Menuju target dibayar</dt><dd>{initialTargetGap}<small>unit lagi</small></dd></div>
            <div><dt>Bisa dipesan sekarang</dt><dd>{initialAvailable}<small>unit</small></dd></div>
          </dl>
        </div>
        <div className={styles.offerPanel}>
          <div className={styles.offerHeading}><span>Harga normal · belum ada promosi</span></div>
          <h3>{demo.product}</h3>
          <div className={styles.offerPrice}><strong>{rupiah(demo.basePrice)}</strong><span>/ unit</span></div>
        </div>
        <div className={styles.reviewNote}><Icon name="check" /><p>Target bukan minimum produksi. Pesanan valid tetap dipenuhi meski target belum tercapai.</p></div>
      </div>
      <p className={styles.stageFootnote}>Slot ditahan menunggu pembayaran. Dibayar belum berarti selesai diserahkan.</p>
    </figure>
  );
}

export function OfferBreakdown() {
  const rows = [
    { label: "Harga normal / unit", value: rupiah(demo.basePrice) },
    { label: `Diskon ${discountPercent}% / unit`, value: `−${rupiah(unitDiscount)}` },
    { label: "Harga penawaran / unit", value: rupiah(offerPrice), emphasized: true },
    { label: "Biaya variabel / unit", value: `−${rupiah(demo.variableCost)}` },
    { label: "Kontribusi / unit", value: rupiah(unitContribution), emphasized: true },
  ];

  return (
    <figure className={styles.breakdown}>
      <figcaption><span>Contoh data sintetis</span><strong>Rencana promosi pada preorder yang sama</strong></figcaption>
      <div className={styles.breakdownSummary}><Icon name="box" /><p><strong>{demo.releasedHeldUnits} slot ditahan sudah dilepas</strong><span>{initialAvailable} slot + {demo.releasedHeldUnits} slot kembali = {campaignStartAvailable} unit tersedia sebelum promosi.</span></p></div>
      <dl className={styles.priceRows}>
        {rows.map((row) => (
          <div className={row.emphasized ? styles.emphasizedRow : undefined} key={row.label}><dt>{row.label}</dt><dd>{row.value}</dd></div>
        ))}
      </dl>
      <p className={styles.breakdownNote}>Kampanye dipilih dengan target tambahan {demo.campaignTargetUnits} unit. Setelah aktif, diskon berlaku untuk semua checkout baru, termasuk pembeli tanpa tautan kampanye. Harga pesanan lama tetap.</p>
    </figure>
  );
}
