"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type PointerEvent, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { ChipCard, type ChipIcon } from "./landing-mocks";
import { dragOffset, sliderPosition, sliderProgressFor, swipeDirection } from "./feature-slider";
import { useScrollProgress } from "./scroll-progress";
import styles from "./landing.module.css";

type FloatingChip = { icon: ChipIcon; title: string; meta: string; x: string; y: string; dx: string; dy: string; rotate: string; mx: string; my: string; delay: number };

// x/y: posisi akhir di sekitar slogan; dx/dy: jarak tambahan saat mulai, jadi kartu bergerak berkumpul ke slogan.
// mx/my: posisi akhir di HP, tiga di atas dan tiga di bawah slogan secara zig-zag agar tidak menutupi teks.
// delay: bagian awal gulir sebelum kartu mulai bergerak, agar kartu datang bergantian.
const CHIPS: FloatingChip[] = [
  { icon: "order", title: "Pesanan baru masuk", meta: "Rina · 2 kotak brownies", x: "-34vw", y: "-27vh", dx: "-14vw", dy: "-18vh", rotate: "-8deg", mx: "-17vw", my: "-39svh", delay: 0 },
  { icon: "paid", title: "QRIS lunas", meta: "Rp90.000 · Sandbox", x: "31vw", y: "-25vh", dx: "16vw", dy: "-16vh", rotate: "7deg", mx: "17vw", my: "-31svh", delay: 0.08 },
  { icon: "capacity", title: "Kapasitas Sabtu", meta: "40 unit, sisa 8", x: "-36vw", y: "6vh", dx: "-18vw", dy: "4vh", rotate: "5deg", mx: "-12vw", my: "-23svh", delay: 0.16 },
  { icon: "ai", title: "Saran Campaign AI", meta: "Titip jual lewat arisan", x: "35vw", y: "8vh", dx: "18vw", dy: "6vh", rotate: "-6deg", mx: "12vw", my: "23svh", delay: 0.12 },
  { icon: "mail", title: "Email terkirim", meta: "Konfirmasi ke pembeli", x: "-22vw", y: "30vh", dx: "-10vw", dy: "18vh", rotate: "-4deg", mx: "-17vw", my: "31svh", delay: 0.04 },
  { icon: "target", title: "Target tercapai", meta: "40 dari 40 unit", x: "22vw", y: "29vh", dx: "10vw", dy: "18vh", rotate: "6deg", mx: "17vw", my: "39svh", delay: 0.2 },
];
/** Animasi selesai pada titik gulir ini; sisa gulir menahan slogan dalam keadaan akhir sebelum lanjut ke bagian berikutnya. */
const UNIFY_ANIMATION_END = 0.72;

/** Slogan di tengah, kartu kegiatan usaha melayang lalu berkumpul ke arahnya selama bagian ini digulir. */
export function UnifyScene() {
  const section = useRef<HTMLElement>(null);
  const setProgress = useCallback((progress: number) => {
    section.current?.style.setProperty("--p", Math.min(progress / UNIFY_ANIMATION_END, 1).toFixed(4));
  }, []);
  useScrollProgress(section, setProgress, true);

  return (
    <section ref={section} className={styles.unify} id="tentang" aria-labelledby="unify-title">
      <div className={styles.unifySticky}>
        <div className={styles.unifyCopy}>
          <p className={styles.unifyBrand}><span className="brand-wordmark" role="img" aria-label="juarasatu" /></p>
          <h2 id="unify-title" className={styles.unifyTitle}>Teman usaha di setiap langkah</h2>
          <p className={styles.unifyLead}>Dari menyiapkan produk sampai pesanan diambil pembeli, semuanya tercatat di satu dasbor.</p>
        </div>
        <div className={styles.unifyChips} aria-hidden="true">
          {CHIPS.map((chip) => (
            <div
              key={chip.title}
              className={styles.floatChip}
              style={{ "--x": chip.x, "--y": chip.y, "--dx": chip.dx, "--dy": chip.dy, "--r": chip.rotate, "--mx": chip.mx, "--my": chip.my, "--d": chip.delay } as CSSProperties}
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

/** Sama dengan media query CSS: layar lebar menempel dengan kata di kiri, HP menempel dengan kartu yang bergeser. */
const PINNED_QUERY = "(min-width: 901px) and (prefers-reduced-motion: no-preference)";
const SLIDER_QUERY = "(max-width: 900px) and (prefers-reduced-motion: no-preference)";
/** Carousel dianggap masuk layar saat bagian atasnya melewati 85% tinggi layar. */
const REVEAL_VIEWPORT_RATIO = 0.85;
/** Foto contoh di kartu HP boleh mengecil sampai batas ini agar kartu muat satu layar tanpa terpotong. */
const MIN_VISUAL_FIT = 0.5;
/** Lama kartu kembali dari posisi mengikuti jari setelah dilepas. */
const DRAG_RELEASE_MS = 320;

function useMediaQuery(query: string): boolean {
  const subscribe = useCallback((onChange: () => void) => {
    const list = window.matchMedia(query);
    list.addEventListener("change", onChange);
    return () => list.removeEventListener("change", onChange);
  }, [query]);
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches, () => false);
}

/** Jarak satu kartu ke kartu berikutnya (lebar kartu ditambah celah), dari posisi aslinya tanpa geseran. */
function slideStep(list: HTMLElement): number {
  const [first, second] = Array.from(list.children);
  if (!(first instanceof HTMLElement)) return 0;
  return second instanceof HTMLElement ? second.offsetLeft - first.offsetLeft : first.offsetWidth;
}

/**
 * Tiga mode, tata letaknya diatur CSS sejak awal dan JavaScript hanya menggerakkan:
 * - Layar lebar: kata fitur menempel di kiri, panel kanan berganti mengikuti gulir; kata bisa diklik.
 * - HP/tablet: bagian menempel satu layar penuh dan gulir ke bawah menggeser kartu ke kiri sampai kartu terakhir; tab bisa ditekan.
 * - Animasi dimatikan: carousel biasa yang digeser jari atau lewat tab dan tombol panah.
 */
export function FeatureScroller({ features }: { features: Feature[] }) {
  const section = useRef<HTMLElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const tabs = useRef<HTMLOListElement>(null);
  const layout = useRef<HTMLDivElement>(null);
  const swipe = useRef<{ x: number; y: number; pointer: number; offset: number } | null>(null);
  const dragFrame = useRef(0);
  const [active, setActive] = useState(0);
  const isPinned = useMediaQuery(PINNED_QUERY);
  const isSlider = useMediaQuery(SLIDER_QUERY);
  const count = features.length;

  const handleProgress = useCallback((progress: number) => {
    if (isPinned) {
      setActive(Math.min(Math.floor(progress * count), count - 1));
      return;
    }
    const list = track.current;
    if (!isSlider || !list) return;
    const position = sliderPosition(progress, count);
    list.style.setProperty("--shift", `${(position * slideStep(list)).toFixed(2)}px`);
    setActive(Math.round(position));
  }, [count, isPinned, isSlider]);
  useScrollProgress(section, handleProgress, true);

  // Geseran hanya milik mode HP; saat berpindah mode, kartu kembali ke posisi asli.
  useEffect(() => {
    const list = track.current;
    if (!isSlider || !list) return;
    return () => {
      list.style.removeProperty("--shift");
    };
  }, [isSlider]);

  // Mode HP: foto contoh di kartu yang terlalu tinggi diperkecil (zoom) sampai kartu muat di layar, dihitung ulang saat ukuran berubah.
  useEffect(() => {
    const list = track.current;
    if (!isSlider || !list || !("ResizeObserver" in window)) return;
    const fit = () => {
      for (const panel of Array.from(list.children)) {
        const visual = panel.querySelector<HTMLElement>("[data-visual]");
        if (!(panel instanceof HTMLElement) || !visual) continue;
        visual.style.setProperty("--fit", "1");
        const overflow = panel.scrollHeight - panel.clientHeight;
        const height = visual.offsetHeight;
        if (overflow > 0 && height > 0) visual.style.setProperty("--fit", Math.max((height - overflow) / height, MIN_VISUAL_FIT).toFixed(3));
      }
    };
    fit();
    // Huruf web yang selesai dimuat bisa mengubah tinggi teks tanpa mengubah ukuran daftar kartu.
    void document.fonts.ready.then(fit);
    const observer = new ResizeObserver(fit);
    observer.observe(list);
    return () => {
      observer.disconnect();
      list.querySelectorAll<HTMLElement>("[data-visual]").forEach((visual) => visual.style.removeProperty("--fit"));
    };
  }, [isSlider]);

  // Mode carousel: panel yang paling banyak terlihat menjadi aktif, baik digeser jari maupun dipilih lewat tab.
  useEffect(() => {
    const list = track.current;
    if (isPinned || isSlider || !list || !("IntersectionObserver" in window)) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && entry.target instanceof HTMLElement) setActive(Number(entry.target.dataset.index));
        }
      },
      { root: list, threshold: 0.6 },
    );
    Array.from(list.children).forEach((panel) => observer.observe(panel));
    return () => observer.disconnect();
  }, [isPinned, isSlider]);

  // Di HP bagian ini muncul perlahan saat masuk layar. Hanya disembunyikan bila memang masih di bawah layar dan pengamat
  // terpasang, jadi bila apa pun gagal isinya tetap terlihat. Atribut diatur langsung (bukan lewat render) dan dihapus saat dibersihkan.
  useEffect(() => {
    const element = layout.current;
    if (isPinned || !element || !("IntersectionObserver" in window) || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (element.getBoundingClientRect().top < window.innerHeight * REVEAL_VIEWPORT_RATIO) return;
    element.dataset.reveal = "pending";
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        element.dataset.reveal = "shown";
        observer.disconnect();
      },
      { rootMargin: `0px 0px -${Math.round((1 - REVEAL_VIEWPORT_RATIO) * 100)}% 0px` },
    );
    observer.observe(element);
    return () => {
      observer.disconnect();
      delete element.dataset.reveal;
    };
  }, [isPinned]);

  // Tab aktif digeser ke tengah baris tab, tanpa menggulir halaman.
  useEffect(() => {
    const list = tabs.current;
    const tab = list?.children[active];
    if (isPinned || !list || !(tab instanceof HTMLElement) || list.scrollWidth <= list.clientWidth) return;
    list.scrollTo({ left: tab.offsetLeft - (list.clientWidth - tab.offsetWidth) / 2, behavior: "smooth" });
  }, [active, isPinned]);

  function scrollSectionTo(progress: number) {
    const element = section.current;
    if (!element) return;
    const top = element.getBoundingClientRect().top + window.scrollY;
    window.scrollTo({ top: top + progress * (element.offsetHeight - window.innerHeight), behavior: "smooth" });
  }

  function select(index: number) {
    const target = Math.min(Math.max(index, 0), count - 1);
    if (isPinned) return scrollSectionTo((target + 0.5) / count);
    if (isSlider) return scrollSectionTo(sliderProgressFor(target, count));
    const list = track.current;
    const panel = list?.children[target];
    const first = list?.firstElementChild;
    if (!list || !(panel instanceof HTMLElement) || !(first instanceof HTMLElement)) return;
    setActive(target);
    list.scrollTo({ left: panel.offsetLeft - first.offsetLeft, behavior: "smooth" });
  }

  // Mode HP: kartu juga bisa digeser jari ke kiri/kanan. Selama digeser kartu mengikuti jari (--drag); setelah dilepas,
  // geseran kembali ke nol dengan halus sementara halaman digulir ke titik kartu tujuan, jadi kartu dan gulir tetap selaras.
  function setDrag(offset: number) {
    track.current?.style.setProperty("--drag", `${offset.toFixed(1)}px`);
  }

  function releaseDrag(from: number) {
    cancelAnimationFrame(dragFrame.current);
    let started: number | null = null;
    const step = (time: number) => {
      started ??= time;
      const progress = Math.min((time - started) / DRAG_RELEASE_MS, 1);
      setDrag(from * (1 - progress) ** 3);
      if (progress < 1) dragFrame.current = requestAnimationFrame(step);
    };
    dragFrame.current = requestAnimationFrame(step);
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (!isSlider || !event.isPrimary) return;
    cancelAnimationFrame(dragFrame.current);
    swipe.current = { x: event.clientX, y: event.clientY, pointer: event.pointerId, offset: 0 };
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    const start = swipe.current;
    if (!start || event.pointerId !== start.pointer) return;
    const deltaX = event.clientX - start.x;
    if (Math.abs(deltaX) < Math.abs(event.clientY - start.y)) return;
    start.offset = dragOffset(deltaX, active, count);
    setDrag(start.offset);
  }

  function handlePointerEnd(event: PointerEvent<HTMLDivElement>) {
    const start = swipe.current;
    if (!start || event.pointerId !== start.pointer) return;
    swipe.current = null;
    releaseDrag(start.offset);
    if (event.type === "pointercancel") return;
    const direction = swipeDirection(event.clientX - start.x, event.clientY - start.y);
    if (direction !== 0) select(active + direction);
  }

  return (
    <section ref={section} className={styles.features} id="fitur" aria-labelledby="fitur-title" style={{ "--count": count } as CSSProperties}>
      <div className={styles.featuresSticky}>
        <div ref={layout} className={`ui-container ${styles.featuresLayout}`}>
          <div className={styles.featuresAside}>
            <h2 className={styles.featuresHeading} id="fitur-title">Fitur utama</h2>
            <ol ref={tabs} className={styles.wordList} aria-label="Pilih fitur">
              {features.map((feature, index) => (
                <li key={feature.word}>
                  <button type="button" data-active={index === active} aria-pressed={index === active} aria-controls={`fitur-panel-${index}`} onClick={() => select(index)}>
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    {feature.word}
                  </button>
                </li>
              ))}
            </ol>
          </div>
          <div className={styles.panelsWrap}>
            <div
              ref={track}
              className={styles.panels}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerEnd}
              onPointerCancel={handlePointerEnd}
            >
              {features.map((feature, index) => (
                <article key={feature.word} id={`fitur-panel-${index}`} data-index={index} className={styles.panel} data-active={index === active} aria-labelledby={`fitur-${index}`}>
                  <p className={styles.panelLabel}>{String(index + 1).padStart(2, "0")} · {feature.word}</p>
                  <h3 id={`fitur-${index}`}>{feature.title}</h3>
                  <p className={styles.panelText}>{feature.description}</p>
                  <div className={styles.panelVisual} data-visual>{feature.visual}</div>
                </article>
              ))}
            </div>
            <div className={styles.carouselNav}>
              <button type="button" aria-label="Fitur sebelumnya" disabled={active === 0} onClick={() => select(active - 1)}><ChevronLeft aria-hidden size={20} /></button>
              <span aria-live="polite">{active + 1} / {count}</span>
              <button type="button" aria-label="Fitur berikutnya" disabled={active === count - 1} onClick={() => select(active + 1)}><ChevronRight aria-hidden size={20} /></button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/** Makin besar makin pelan mengejar posisi gulir; ~220ms membuat gerakan terasa perlahan tanpa tertinggal jauh. */
const DRAW_SMOOTHING_MS = 220;
/** Kartu contoh di pembuka mengejar lebih pelan lagi, agar perjalanannya sempat diperhatikan. */
const CARD_SMOOTHING_MS = 750;
const DRAW_EPSILON = 0.001;

function clampUnit(value: number): number {
  return Math.min(Math.max(value, 0), 1);
}

/**
 * Langkah muncul saat bagian atasnya naik dari 96% ke 62% tinggi layar. Panah tergambar sepanjang ia melewati layar,
 * mulai saat bagian atasnya di 88% tinggi layar. Kartu contoh di pembuka terbang sepanjang bagian atasnya naik dari bawah
 * layar sampai 10% tinggi layar; saat halaman baru dibuka kartu itu hampir belum muncul.
 */
function drawTarget(element: HTMLElement, viewport: number): number {
  const rect = element.getBoundingClientRect();
  if (element.dataset.scrollDraw === "arrow") return clampUnit((viewport * 0.88 - rect.top) / (rect.height + viewport * 0.3));
  if (element.dataset.scrollDraw === "card") return clampUnit((viewport - rect.top) / (viewport * 0.9));
  return clampUnit((viewport * 0.96 - rect.top) / (viewport * 0.34));
}

/**
 * Mengisi `--v` (0..1) pada setiap `[data-scroll-draw]` mengikuti gulir: naik saat digulir ke bawah dan turun lagi saat
 * digulir ke atas, jadi langkah dan panah muncul dan menghilang di kedua arah. Nilainya mengejar posisi gulir secara bertahap.
 * Elemen dicari ulang setiap frame agar tetap bekerja walau komponen dipasang ulang. Tanpa JavaScript atau saat animasi
 * dimatikan, `--v` tidak pernah diisi dan CSS menampilkan semuanya penuh.
 */
export function ScrollDrawEffects() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const values = new WeakMap<Element, number>();
    let frame = 0;
    let lastTime = 0;

    function tick(time: number) {
      frame = 0;
      const elapsed = lastTime ? Math.min(time - lastTime, 64) : 16;
      lastTime = time;
      const follow = 1 - Math.exp(-elapsed / DRAW_SMOOTHING_MS);
      const cardFollow = 1 - Math.exp(-elapsed / CARD_SMOOTHING_MS);
      const viewport = window.innerHeight;
      let moving = false;
      for (const element of document.querySelectorAll<HTMLElement>("[data-scroll-draw]")) {
        const target = drawTarget(element, viewport);
        const previous = values.get(element);
        const rate = element.dataset.scrollDraw === "card" ? cardFollow : follow;
        let next = previous === undefined ? target : previous + (target - previous) * rate;
        if (Math.abs(target - next) < DRAW_EPSILON) next = target;
        else moving = true;
        values.set(element, next);
        element.style.setProperty("--v", next.toFixed(4));
      }
      if (moving) frame = requestAnimationFrame(tick);
      else lastTime = 0;
    }

    function schedule() {
      if (!frame) frame = requestAnimationFrame(tick);
    }

    tick(0);
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      cancelAnimationFrame(frame);
      document.querySelectorAll<HTMLElement>("[data-scroll-draw]").forEach((element) => element.style.removeProperty("--v"));
    };
  }, []);
  return null;
}
