import { Icon } from "@/components/ui/icon";
import { campaignContribution, campaignProductionCost, campaignRevenue, completionLabel, demo, finalAvailable, finalFulfilledUnits, finalPaidUnits, goalCompletion, preorderContribution, preorderProductionCost, preorderRevenue, rupiah } from "./demo-data";
import styles from "./landing.module.css";

export function ResultPreview() {
  const preorderRows = [
    { label: "Penjualan pesanan diserahkan", value: rupiah(preorderRevenue) },
    { label: "Biaya produksi tercatat", value: `−${rupiah(preorderProductionCost)}` },
    { label: "Biaya promosi tercatat", value: `−${rupiah(demo.actualPromotionCost)}` },
  ];
  const campaignRows = [
    { label: `Penjualan ${demo.campaignFulfilledUnits} unit diserahkan`, value: rupiah(campaignRevenue) },
    { label: `Biaya produksi ${demo.campaignFulfilledUnits} unit`, value: `−${rupiah(campaignProductionCost)}` },
    { label: "Biaya promosi tercatat", value: `−${rupiah(demo.actualPromotionCost)}` },
  ];

  return (
    <div className={styles.analyticsPreviews}>
      <figure className={styles.resultPreview} aria-label="Pratinjau laporan seluruh preorder">
        <figcaption><span>Contoh data sintetis · laporan 01</span><strong>Seluruh preorder</strong></figcaption>
        <div className={styles.fulfilledSummary}>
          <div><span>Unit dibayar valid · simulasi</span><strong>{finalPaidUnits}<small> / {demo.target} target</small></strong></div>
          <span className={styles.completionBadge}><Icon name="chart" />{completionLabel} target</span>
        </div>
        <div className={styles.goalTrack} role="img" aria-label={`Target dibayar ${completionLabel}: ${finalPaidUnits} dari ${demo.target} unit. Bukan ukuran penyelesaian produksi.`}>
          <span style={{ width: `${goalCompletion * 100}%` }} />
        </div>
        <p className={styles.snapshotNote}>Pada snapshot akhir ini, {finalFulfilledUnits} unit juga sudah diserahkan. Status dibayar dan pemenuhan tetap dicatat terpisah.</p>
        <dl className={styles.resultRows}>
          {preorderRows.map((row) => <div key={row.label}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}
          <div className={styles.resultTotal}><dt>Kontribusi preorder<small>Sebelum biaya lain, bukan laba bersih.</small></dt><dd>{rupiah(preorderContribution)}</dd></div>
        </dl>
        <div className={styles.finalCapacity}><Icon name="box" /><p><strong>{finalAvailable} unit masih tersedia · {demo.finalHeldUnits} ditahan</strong><span>Angka seluruh preorder mencakup pesanan sebelum dan selama kampanye.</span></p></div>
      </figure>
      <figure className={styles.resultPreview} aria-label="Pratinjau laporan periode kampanye">
        <figcaption><span>Contoh data sintetis · laporan 02</span><strong>Periode kampanye</strong></figcaption>
        <dl className={styles.campaignMetrics}>
          <div><dt>Dibayar selama periode</dt><dd>{demo.campaignPaidUnits}<small>unit</small></dd></div>
          <div><dt>Dari tautan kampanye</dt><dd>{demo.campaignAttributedUnits}<small>unit</small></dd></div>
          <div><dt>Mendapat diskon</dt><dd>{demo.campaignDiscountedUnits}<small>unit</small></dd></div>
        </dl>
        <dl className={styles.resultRows}>
          {campaignRows.map((row) => <div key={row.label}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}
          <div className={styles.resultTotal}><dt>Kontribusi periode<small>Biaya contoh lengkap; sebelum biaya lain.</small></dt><dd>{rupiah(campaignContribution)}</dd></div>
        </dl>
        <p className={styles.resultFootnote}>Laporan periode adalah bagian dari laporan preorder. Jangan menjumlahkan keduanya. Nilai simulasi bukan uang nyata atau bukti dampak promosi.</p>
      </figure>
    </div>
  );
}
