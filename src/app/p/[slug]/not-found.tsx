import Link from "next/link";
import { BuyerShell } from "@/features/public-preorder/page-view";
import styles from "@/features/public-preorder/public-preorder.module.css";

export default function NotFound() {
  return <BuyerShell><main id="konten-preorder" className={`${styles.main} ${styles.message}`}><h1>Preorder tidak tersedia</h1><p>Periksa kembali tautan dari usaha. Jika masih belum terbuka, hubungi usaha yang membagikannya.</p><Link href="/" className={styles.textLink}>Kembali ke juarasatu</Link></main></BuyerShell>;
}
