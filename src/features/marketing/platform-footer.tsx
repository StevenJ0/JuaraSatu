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
            <a href="#cara-pakai">Cara pakai</a>
            <a href="#beranda">Kembali ke atas<Icon name="arrow-up-right" /></a>
          </nav>
        </div>
        <p className={styles.footerStatus} id="status-produk" tabIndex={-1}>Angka pada halaman ini adalah contoh tampilan. Pembayaran memakai Midtrans Sandbox: simulasi, tanpa uang sungguhan.</p>
      </div>
    </footer>
  );
}
