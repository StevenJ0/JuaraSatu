import { Icon } from "@/components/ui/icon";
import { completionLabel, demo, estimatedContribution, finalAvailable, fulfilledValue, fulfilledVariableCost, goalCompletion, rupiah } from "./demo-data";
import styles from "./landing.module.css";

export function ResultPreview() {
  const rows = [
    { label: "Nilai penjualan simulasi", value: rupiah(fulfilledValue) },
    { label: "Biaya variabel", value: `−${rupiah(fulfilledVariableCost)}` },
    { label: "Biaya promosi aktual tercatat", value: `−${rupiah(demo.actualPromotionCost)}` },
  ];

  return (
    <figure className={styles.resultPreview}>
      <figcaption><span>Contoh data sintetis</span><strong>Hasil akhir {demo.campaign}</strong></figcaption>
      <div className={styles.fulfilledSummary}>
        <div><span>Selesai diserahkan</span><strong>{demo.fulfilled}<small> / {demo.target} kotak</small></strong></div>
        <span className={styles.completionBadge}><Icon name="chart" />{completionLabel} target</span>
      </div>
      <div className={styles.goalTrack} role="img" aria-label={`Capaian target ${completionLabel}, ${demo.fulfilled} dari ${demo.target} kotak selesai diserahkan.`}>
        <span style={{ width: `${goalCompletion * 100}%` }} />
      </div>
      <dl className={styles.resultRows}>
        {rows.map((row) => <div key={row.label}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}
        <div className={styles.resultTotal}><dt>Estimasi kontribusi<small>Sebelum biaya lain, bukan laba bersih.</small></dt><dd>{rupiah(estimatedContribution)}</dd></div>
      </dl>
      <div className={styles.finalCapacity}><Icon name="box" /><p><strong>{finalAvailable} kotak kapasitas tersisa</strong><span>{demo.capacity} kapasitas − {demo.previouslyAllocated} alokasi lama − {demo.fulfilled} kotak kampanye.</span></p></div>
      <p className={styles.resultFootnote}>Nilai demo/sandbox, bukan penerimaan uang nyata. Hanya kotak yang selesai diserahkan dihitung dalam contoh hasil ini.</p>
    </figure>
  );
}
