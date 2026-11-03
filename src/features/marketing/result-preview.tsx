import { Icon } from "@/components/ui/icon";
import { campaignContribution, campaignProductionCost, campaignRevenue, campaignUnattributedUnits, completionLabel, demo, finalAvailable, finalFulfilledUnits, finalPaidUnits, preorderContribution, preorderProductionCost, preorderRevenue, rupiah } from "./demo-data";
import styles from "./landing.module.css";

export function ResultPreview() {
  return (
    <div className={styles.results}>
      <div className="ui-container">
        <div className={styles.reportPair}>
          <figure className={styles.report} id="laporan-preorder" tabIndex={-1} aria-labelledby="preorder-report-title">
            <figcaption id="preorder-report-title">Seluruh preorder</figcaption>
            <p className={styles.reportNumber}><strong>{finalPaidUnits}</strong><span>unit sudah dibayar</span></p>
            <p className={styles.reportContext}>{completionLabel} dari target {demo.target} unit. Masih ada {finalAvailable} unit tersedia.</p>
            <details className={styles.reportDetails}>
              <summary>Lihat rincian biaya dan kontribusi<Icon name="arrow-right" className={styles.downArrow} /></summary>
              <div>
                <p className={styles.reportAssumption}>Pada akhir contoh ini, {finalFulfilledUnits} unit juga sudah diserahkan. Pembayaran dan penyerahan tetap dua status berbeda.</p>
                <dl className={styles.reportRows}>
                  <div><dt>Nilai pesanan yang diserahkan</dt><dd>{rupiah(preorderRevenue)}</dd></div>
                  <div><dt>Biaya produksi tercatat</dt><dd>−{rupiah(preorderProductionCost)}</dd></div>
                  <div><dt>Biaya promosi tercatat</dt><dd>−{rupiah(demo.actualPromotionCost)}</dd></div>
                  <div className={styles.reportTotal}><dt>Kontribusi preorder</dt><dd>{rupiah(preorderContribution)}</dd></div>
                </dl>
                <p className={styles.reportAssumption}>Kontribusi dihitung setelah biaya di atas, sebelum biaya lainnya. Nilai ini bukan laba bersih.</p>
              </div>
            </details>
          </figure>
          <figure className={styles.report} id="laporan-promosi" tabIndex={-1} aria-labelledby="campaign-report-title">
            <figcaption id="campaign-report-title">Selama promosi</figcaption>
            <p className={styles.reportNumber}><strong>{demo.campaignPaidUnits}</strong><span>unit tambahan dibayar</span></p>
            <p className={styles.reportContext}>{demo.campaignAttributedUnits} lewat tautan promosi, {campaignUnattributedUnits} tanpa tautan itu.</p>
            <details className={styles.reportDetails}>
              <summary>Lihat rincian biaya dan kontribusi<Icon name="arrow-right" className={styles.downArrow} /></summary>
              <div>
                <p className={styles.reportAssumption}>{demo.campaignDiscountedUnits} unit mendapat diskon. Pada contoh akhir, {demo.campaignFulfilledUnits} unit tersebut sudah diserahkan.</p>
                <dl className={styles.reportRows}>
                  <div><dt>Nilai pesanan yang diserahkan</dt><dd>{rupiah(campaignRevenue)}</dd></div>
                  <div><dt>Biaya produksi tercatat</dt><dd>−{rupiah(campaignProductionCost)}</dd></div>
                  <div><dt>Biaya promosi tercatat</dt><dd>−{rupiah(demo.actualPromotionCost)}</dd></div>
                  <div className={styles.reportTotal}><dt>Kontribusi periode</dt><dd>{rupiah(campaignContribution)}</dd></div>
                </dl>
                <p className={styles.reportAssumption}>Kontribusi dihitung setelah biaya di atas, sebelum biaya lainnya. Tambahan pesanan selama promosi belum membuktikan bahwa promosi penyebabnya.</p>
              </div>
            </details>
          </figure>
        </div>
        <p className={styles.resultNote}><Icon name="notes" /><span>Hasil selama promosi sudah termasuk dalam seluruh preorder. Kedua laporan tidak dijumlahkan. Semua angka di sini adalah data contoh.</span></p>
      </div>
    </div>
  );
}
