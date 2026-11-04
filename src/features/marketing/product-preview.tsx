import { Icon } from "@/components/ui/icon";
import { campaignStartAvailable, demo, discountPercent, initialAvailable, offerPrice, rupiah, unitContribution, unitDiscount } from "./demo-data";
import styles from "./landing.module.css";

/** Original product illustration, decorative beside the named product. */
function ShirtIllustration() {
  return (
    <svg viewBox="0 0 100 110" fill="none" aria-hidden="true" focusable="false">
      <path d="m31 21 10-5h18l10 5 21 13-12 22-10-6v47H32V50l-10 6-12-22 21-13Z" fill="currentColor" />
      <path d="M41 16c0 12 18 12 18 0M32 50V35m36 15V35M36 91h28" stroke="var(--ui-canvas)" strokeWidth="2" />
    </svg>
  );
}

/** Shared static device preview, with a unique title ID for each placement. */
export function PreorderPhone({ titleId }: { titleId: string }) {
  return (
      <div className={styles.phoneFrame}>
        <div className={styles.phoneHardware} aria-hidden="true"><span /><i /></div>
        <div className={styles.orderSheet}>
          <div className={styles.deviceToolbar}><span>Campaign Lab</span><span>Contoh preorder</span></div>
          <div className={styles.productIdentity}>
            <div className={styles.productIllustration}><ShirtIllustration /></div>
            <div><p className={styles.productType}>Satu jenis produk</p><h2 id={titleId}>{demo.product}</h2><p>Satu jadwal pengambilan</p><strong>{rupiah(demo.basePrice)}<small> / unit</small></strong></div>
          </div>
          <div className={styles.availableHeadline}><span>Masih bisa menerima</span><p><strong>{initialAvailable}</strong><span>unit pesanan</span></p></div>
          <div className={styles.capacityBar} role="img" aria-label={`Kapasitas ${demo.capacity} unit: ${demo.initialPaidUnits} dibayar, ${demo.initialHeldUnits} menunggu pembayaran, ${initialAvailable} tersedia.`}>
            <span className={styles.paidSegment} style={{ flex: demo.initialPaidUnits }} />
            <span className={styles.heldSegment} style={{ flex: demo.initialHeldUnits }} />
            <span className={styles.availableSegment} style={{ flex: initialAvailable }} />
          </div>
          <dl className={styles.capacityLedger}>
            <div><dt>Kapasitas preorder</dt><dd>{demo.capacity}<small>unit</small></dd></div>
            <div><dt><i className={styles.paidKey} aria-hidden="true" />Sudah dibayar</dt><dd>−{demo.initialPaidUnits}<small>unit</small></dd></div>
            <div><dt><i className={styles.heldKey} aria-hidden="true" />Menunggu pembayaran</dt><dd>−{demo.initialHeldUnits}<small>unit</small></dd></div>
          </dl>
          <p className={styles.sheetNote}>Slot yang menunggu pembayaran belum bisa dijual lagi.</p>
        </div>
      </div>
  );
}

export function ProductPreview() {
  return (
    <figure className={styles.productPreview} id="contoh-penggunaan" tabIndex={-1} aria-labelledby="preorder-preview-title">
      <div className={styles.previewBackdrop} aria-hidden="true" />
      <PreorderPhone titleId="preorder-preview-title" />
      <figcaption className={styles.previewFootnote}><strong>01 / Pesanan masuk</strong><span>Ilustrasi preorder kaos. Ikuti angka yang sama sampai laporan hasil.</span><a href="#cara-kerja">Lanjut ke penawaran<Icon name="arrow-right" /></a></figcaption>
    </figure>
  );
}

export function OfferBreakdown() {
  return (
    <figure className={styles.offerPreview} aria-labelledby="offer-preview-title">
      <figcaption className={styles.offerCaption}><span>Simulasi penawaran</span><span>{campaignStartAvailable} unit tersedia</span></figcaption>
      <div className={styles.offerHeading}><h3 id="offer-preview-title">{demo.campaign}</h3><span>Diskon {discountPercent}%</span></div>
      <div className={styles.offerPrice}><span>Harga yang akan dilihat pelanggan</span><strong>{rupiah(offerPrice)}<small> / unit</small></strong></div>
      <dl className={styles.offerRows}>
        <div><dt>Harga normal</dt><dd>{rupiah(demo.basePrice)}</dd></div>
        <div><dt>Potongan {discountPercent}%</dt><dd>−{rupiah(unitDiscount)}</dd></div>
        <div><dt>Biaya variabel per unit</dt><dd>−{rupiah(demo.variableCost)}</dd></div>
        <div className={styles.contributionRow}><dt>Sisa kontribusi per unit</dt><dd>{rupiah(unitContribution)}</dd></div>
      </dl>
      <p className={styles.offerFootnote}>Kontribusi adalah sisa harga setelah biaya variabel. Biaya promosi dan biaya lainnya belum dikurangi.</p>
      <details className={styles.offerDetails}>
        <summary>Bagaimana penawaran ini berlaku?<Icon name="arrow-right" className={styles.downArrow} /></summary>
        <div><p>{initialAvailable} slot awal + {demo.releasedHeldUnits} reservasi dilepas = {campaignStartAvailable} unit tersedia. Sasaran promosi contoh ini {demo.campaignTargetUnits} unit tambahan yang dibayar.</p><p>Diskon berlaku untuk semua pemesanan baru selama promosi aktif. Harga pesanan sebelumnya tetap. Penawaran belum diterbitkan hanya dengan memilih ide atau menyetujui rencana.</p></div>
      </details>
    </figure>
  );
}
