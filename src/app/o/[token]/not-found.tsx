import Link from "next/link";
import { BuyerShell } from "@/features/public-preorder/page-view";
import styles from "@/features/public-preorder/public-preorder.module.css";

/** Sama untuk token salah dan pesanan yang tidak ada, agar keberadaan pesanan lain tidak bocor. */
export default function NotFound() {
  return <BuyerShell><main id="konten-preorder" className={`${styles.main} ${styles.message}`}><h1>Pesanan tidak ditemukan</h1><p>Periksa kembali tautan pesananmu. Tautan pesanan hanya dimiliki pembeli yang membuatnya.</p><Link href="/" className={styles.textLink}>Kembali ke Juara Satu</Link></main></BuyerShell>;
}
