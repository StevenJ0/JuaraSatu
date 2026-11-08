import { BuyerShell } from "@/features/public-preorder/page-view";
import styles from "@/features/public-preorder/public-preorder.module.css";

export default function Loading() {
  return <BuyerShell><main id="konten-preorder" className={`${styles.main} ${styles.message}`} aria-busy="true"><p role="status">Memuat informasi preorder…</p></main></BuyerShell>;
}
