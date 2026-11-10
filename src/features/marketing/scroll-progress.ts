"use client";

import { useEffect, type RefObject } from "react";

/** Makin besar makin lambat mengejar posisi gulir; ~120ms terasa halus tanpa tertinggal jauh. */
const SMOOTHING_MS = 120;
const SETTLE_EPSILON = 0.0005;

/**
 * Memanggil `onProgress` dengan 0..1 selama bagian setinggi beberapa layar digulir melewati layar: 0 saat bagian baru
 * menyentuh atas layar, 1 saat ujung bawahnya tiba di bawah layar. Dibatasi satu kali per frame.
 * Dengan `smooth`, nilai mengejar posisi gulir secara bertahap, sehingga gulir roda mouse yang patah-patah tetap
 * menghasilkan gerakan mulus. Saat halaman dibuka, nilai langsung di posisi gulir tanpa animasi.
 */
export function useScrollProgress(ref: RefObject<HTMLElement | null>, onProgress: (progress: number) => void, smooth = false) {
  useEffect(() => {
    let frame = 0;
    let current: number | null = null;
    let lastTime = 0;

    function read(): number | null {
      const element = ref.current;
      if (!element) return null;
      const distance = element.offsetHeight - window.innerHeight;
      const progress = distance > 0 ? -element.getBoundingClientRect().top / distance : 1;
      return Math.min(Math.max(progress, 0), 1);
    }

    function tick(time: number) {
      frame = 0;
      const target = read();
      if (target === null) return;
      if (!smooth || current === null) {
        current = target;
        onProgress(current);
        return;
      }
      const elapsed = lastTime ? Math.min(time - lastTime, 64) : 16;
      lastTime = time;
      current += (target - current) * (1 - Math.exp(-elapsed / SMOOTHING_MS));
      if (Math.abs(target - current) < SETTLE_EPSILON) current = target;
      onProgress(current);
      if (current !== target) frame = requestAnimationFrame(tick);
      else lastTime = 0;
    }

    function schedule() {
      if (!frame) frame = requestAnimationFrame(tick);
    }

    tick(performance.now());
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      cancelAnimationFrame(frame);
    };
  }, [ref, onProgress, smooth]);
}
