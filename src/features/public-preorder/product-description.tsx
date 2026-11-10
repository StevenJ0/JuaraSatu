"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./public-preorder.module.css";

/**
 * Deskripsi bisa sampai 1000 karakter, jadi awalnya dibatasi beberapa baris agar form pesan tidak terdorong jauh.
 * Tombol "Baca selengkapnya" hanya muncul bila teksnya memang terpotong.
 */
export function ProductDescription({ text }: { text: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isClamped, setIsClamped] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => setIsClamped(element.scrollHeight > element.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return <>
    <p ref={ref} id="deskripsi-produk" className={`${styles.description} ${isExpanded ? "" : styles.descriptionClamped}`}>{text}</p>
    {(isClamped || isExpanded) && (
      <button type="button" className={styles.readMore} aria-expanded={isExpanded} aria-controls="deskripsi-produk" onClick={() => setIsExpanded(!isExpanded)}>
        {isExpanded ? "Tampilkan lebih sedikit" : "Baca selengkapnya"}
      </button>
    )}
  </>;
}
