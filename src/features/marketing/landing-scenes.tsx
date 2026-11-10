"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ChipCard, type ChipIcon } from "./landing-mocks";
import { useScrollProgress } from "./scroll-progress";
import styles from "./landing.module.css";

type FloatingChip = { icon: ChipIcon; title: string; meta: string; x: string; y: string; dx: string; dy: string; rotate: string; mx?: string; my?: string };

// x/y: posisi akhir di sekitar slogan; dx/dy: jarak tambahan saat mulai, jadi kartu bergerak berkumpul ke slogan.
// mx/my: posisi akhir di HP; kartu tanpa mx/my disembunyikan di HP agar slogan tetap terbaca.
const CHIPS: FloatingChip[] = [
  { icon: "order", title: "Pesanan baru masuk", meta: "Rina · 2 kotak brownies", x: "-34vw", y: "-27vh", dx: "-14vw", dy: "-18vh", rotate: "-8deg", mx: "-14vw", my: "-36vh" },
  { icon: "paid", title: "QRIS lunas", meta: "Rp90.000 · Sandbox", x: "31vw", y: "-25vh", dx: "16vw", dy: "-16vh", rotate: "7deg", mx: "14vw", my: "-28vh" },
  { icon: "capacity", title: "Kapasitas Sabtu", meta: "40 unit, sisa 8", x: "-36vw", y: "6vh", dx: "-18vw", dy: "4vh", rotate: "5deg" },
  { icon: "ai", title: "Saran Campaign AI", meta: "Titip jual lewat arisan", x: "35vw", y: "8vh", dx: "18vw", dy: "6vh", rotate: "-6deg" },
  { icon: "mail", title: "Email terkirim", meta: "Konfirmasi ke pembeli", x: "-22vw", y: "30vh", dx: "-10vw", dy: "18vh", rotate: "-4deg", mx: "-14vw", my: "24vh" },
  { icon: "target", title: "Target tercapai", meta: "40 dari 40 unit", x: "22vw", y: "29vh", dx: "10vw", dy: "18vh", rotate: "6deg", mx: "14vw", my: "33vh" },
];

/** Slogan di tengah, kartu kegiatan usaha melayang lalu berkumpul ke arahnya selama bagian ini digulir. */
export function UnifyScene() {
  const section = useRef<HTMLElement>(null);
  const setProgress = useCallback((progress: number) => {
    section.current?.style.setProperty("--p", progress.toFixed(3));
  }, []);
  useScrollProgress(section, setProgress);

  return (
    <section ref={section} className={styles.unify} id="tentang" aria-labelledby="unify-title">
      <div className={styles.unifySticky}>
        <div className={styles.unifyCopy}>
          <p className={styles.eyebrow}>juarasatu</p>
          <h2 id="unify-title" className={styles.unifyTitle}>Teman usaha di setiap langkah</h2>
          <p className={styles.unifyLead}>Dari menyiapkan produk sampai pesanan diambil pembeli, semuanya tercatat di satu dasbor.</p>
        </div>
        <div aria-hidden="true">
          {CHIPS.map((chip) => (
            <div
              key={chip.title}
              className={styles.floatChip}
              data-mobile={Boolean(chip.mx)}
              style={{ "--x": chip.x, "--y": chip.y, "--dx": chip.dx, "--dy": chip.dy, "--r": chip.rotate, "--mx": chip.mx, "--my": chip.my } as CSSProperties}
            >
              <ChipCard icon={chip.icon} title={chip.title} meta={chip.meta} />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export type Feature = { word: string; title: string; description: string; visual: ReactNode };

/**
 * Di layar lebar, kata fitur menempel di kiri dan panel di kanan berganti mengikuti gulir. Di layar kecil atau saat animasi
 * dimatikan, CSS menampilkan semua panel berurutan, jadi isi tetap utuh tanpa bergantung pada posisi gulir.
 */
export function FeatureScroller({ features }: { features: Feature[] }) {
  const section = useRef<HTMLElement>(null);
  const [active, setActive] = useState(0);
  const count = features.length;
  const updateActive = useCallback((progress: number) => setActive(Math.min(Math.floor(progress * count), count - 1)), [count]);
  useScrollProgress(section, updateActive);

  return (
    <section ref={section} className={styles.features} id="fitur" aria-labelledby="fitur-title" style={{ "--count": count } as CSSProperties}>
      <div className={styles.featuresSticky}>
        <div className={`ui-container ${styles.featuresLayout}`}>
          <div className={styles.featuresAside}>
            <h2 className={styles.featuresHeading} id="fitur-title">Fitur utama</h2>
            <ol className={styles.wordList} aria-hidden="true">
              {features.map((feature, index) => (
                <li key={feature.word} data-active={index === active}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  {feature.word}
                </li>
              ))}
            </ol>
          </div>
          <div className={styles.panels}>
            {features.map((feature, index) => (
              <article key={feature.word} className={styles.panel} data-active={index === active} aria-labelledby={`fitur-${index}`}>
                <p className={styles.panelLabel}>{String(index + 1).padStart(2, "0")} · {feature.word}</p>
                <h3 id={`fitur-${index}`}>{feature.title}</h3>
                <p className={styles.panelText}>{feature.description}</p>
                <div className={styles.panelVisual}>{feature.visual}</div>
              </article>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/** Menandai elemen `[data-reveal]` saat masuk layar, untuk efek muncul dan panah yang tergambar. Sekali tampil, tetap tampil. */
export function RevealObserver() {
  useEffect(() => {
    const targets = document.querySelectorAll<HTMLElement>("[data-reveal]");
    if (!("IntersectionObserver" in window)) {
      targets.forEach((target) => target.setAttribute("data-shown", "true"));
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.setAttribute("data-shown", "true");
          observer.unobserve(entry.target);
        }
      },
      { rootMargin: "0px 0px -15% 0px" },
    );
    targets.forEach((target) => observer.observe(target));
    return () => observer.disconnect();
  }, []);
  return null;
}
