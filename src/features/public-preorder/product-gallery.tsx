"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Package } from "lucide-react";
import type { PublicPreorder } from "@/features/preorders/context";
import styles from "./public-preorder.module.css";

type ProductGalleryProps = { name: string; photos: PublicPreorder["product"]["photos"] };

const AUTOPLAY_INTERVAL_MS = 4000;

/**
 * Foto besar bergeser sendiri setiap 4 detik bila ada lebih dari satu foto. Begitu pembeli menekan panah atau foto kecil,
 * pergeseran otomatis berhenti agar foto yang sedang dilihat tidak berpindah. Pembeli yang meminta gerak dikurangi
 * (prefers-reduced-motion) tidak mendapat pergeseran otomatis sama sekali.
 */
export function ProductGallery({ name, photos }: ProductGalleryProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [isAutoplay, setIsAutoplay] = useState(true);
  const count = photos.length;

  useEffect(() => {
    if (!isAutoplay || count < 2 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setInterval(() => setActiveIndex((index) => (index + 1) % count), AUTOPLAY_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [isAutoplay, count]);

  function show(index: number) {
    setIsAutoplay(false);
    setActiveIndex((index + count) % count);
  }

  if (count === 0) {
    return <div className={styles.media}>
      <div className={styles.photo}><div className={styles.noPhoto}><Package size={48} strokeWidth={1} aria-hidden="true" /><span>Foto produk belum tersedia</span></div></div>
    </div>;
  }

  return <div className={styles.media}>
    <div className={styles.photo} role={count > 1 ? "group" : undefined} aria-roledescription={count > 1 ? "galeri" : undefined} aria-label={count > 1 ? `Foto ${name}` : undefined}>
      <div className={styles.slideTrack} style={{ transform: `translateX(-${activeIndex * 100}%)` }}>
        {photos.map((photo, index) => (
          <Image key={photo.url} src={photo.url} alt={count > 1 ? `${name}, foto ${index + 1} dari ${count}` : name} width={1000} height={1000}
            priority={index === 0} unoptimized className={styles.productImage} aria-hidden={index === activeIndex ? undefined : true} />
        ))}
      </div>
      {count > 1 && <>
        <button type="button" className={`${styles.slideArrow} ${styles.slidePrev}`} aria-label="Foto sebelumnya" onClick={() => show(activeIndex - 1)}><ChevronLeft size={22} aria-hidden="true" /></button>
        <button type="button" className={`${styles.slideArrow} ${styles.slideNext}`} aria-label="Foto berikutnya" onClick={() => show(activeIndex + 1)}><ChevronRight size={22} aria-hidden="true" /></button>
        <span className={styles.slideCount} aria-live={isAutoplay ? "off" : "polite"}>{activeIndex + 1} / {count}</span>
      </>}
    </div>
    {count > 1 && <ul className={styles.thumbnails} aria-label="Pilih foto produk">
      {photos.map((photo, index) => <li key={photo.url}>
        <button type="button" className={styles.thumbnail} aria-label={`Lihat foto ${index + 1}`} aria-pressed={index === activeIndex} onClick={() => show(index)}>
          <Image src={photo.thumbnailUrl} alt="" width={72} height={72} unoptimized />
        </button>
      </li>)}
    </ul>}
  </div>;
}
