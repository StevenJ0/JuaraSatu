"use client";

import { BuyerShell } from "@/features/public-preorder/page-view";
import styles from "@/features/public-preorder/public-preorder.module.css";

export default function Error({ reset }: { reset: () => void }) {
  return <BuyerShell><main id="konten-preorder" className={`${styles.main} ${styles.message}`}><h1>Informasi preorder belum dapat dimuat</h1><p>Coba lagi sebentar. Jika masalah berlanjut, hubungi usaha melalui kontak yang membagikan tautan ini.</p><button type="button" onClick={reset} className={styles.retry}>Coba lagi</button></main></BuyerShell>;
}
