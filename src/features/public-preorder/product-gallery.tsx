"use client";

import Image from "next/image";
import { useState } from "react";
import { Package } from "lucide-react";
import type { PublicPreorder } from "@/features/preorders/context";
import styles from "./public-preorder.module.css";

type ProductGalleryProps = { name: string; photos: PublicPreorder["product"]["photos"] };

/** Foto utama besar; bila ada lebih dari satu foto, versi kecilnya di bawah menjadi tombol untuk mengganti foto besar. */
export function ProductGallery({ name, photos }: ProductGalleryProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const active = photos[activeIndex];

  return <div className={styles.media}>
    <div className={styles.photo}>
      {active
        ? <Image src={active.url} alt={photos.length > 1 ? `${name}, foto ${activeIndex + 1} dari ${photos.length}` : name} width={1000} height={1100} priority unoptimized className={styles.productImage} />
        : <div className={styles.noPhoto}><Package size={48} strokeWidth={1} aria-hidden="true" /><span>Foto produk belum tersedia</span></div>}
      <span className={styles.photoCaption}>Satu produk. Satu jadwal pengambilan.</span>
    </div>
    {photos.length > 1 && <ul className={styles.thumbnails} aria-label="Pilih foto produk">
      {photos.map((photo, index) => <li key={photo.url}>
        <button type="button" className={styles.thumbnail} aria-label={`Lihat foto ${index + 1}`} aria-pressed={index === activeIndex} onClick={() => setActiveIndex(index)}>
          <Image src={photo.thumbnailUrl} alt="" width={72} height={72} unoptimized />
        </button>
      </li>)}
    </ul>}
  </div>;
}
