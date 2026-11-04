import { Brand } from "@/components/brand";
import { Icon } from "@/components/ui/icon";
import { site } from "@/config/site";
import styles from "./landing.module.css";

/** Minimal information strip beneath the closing product illustration. */
export function PlatformFooter() {
  return (
    <footer className={styles.footer}>
      <div className="ui-container">
        <div className={styles.footerBottom}>
          <Brand />
          <p>© 2026 {site.name} · GTNIC 2026</p>
          <nav aria-label="Navigasi footer">
            <a href="#pertanyaan-umum">Pertanyaan umum</a>
            <a href="#beranda">Kembali ke atas<Icon name="arrow-up-right" /></a>
          </nav>
        </div>
        <p className={styles.footerStatus} id="status-produk" tabIndex={-1}>Tahap prototipe. Seluruh angka adalah data sintetis. Pemesanan, AI, pembayaran, dan email belum terhubung. Simulasi pembayaran direncanakan melalui Midtrans Sandbox, tanpa uang nyata.</p>
      </div>
    </footer>
  );
}
