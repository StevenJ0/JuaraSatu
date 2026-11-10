"use client";

import { useEffect, type RefObject } from "react";

/**
 * Memanggil `onProgress` dengan 0..1 selama bagian setinggi beberapa layar digulir melewati layar: 0 saat bagian baru
 * menyentuh atas layar, 1 saat ujung bawahnya tiba di bawah layar. Dibatasi satu kali per frame.
 */
export function useScrollProgress(ref: RefObject<HTMLElement | null>, onProgress: (progress: number) => void) {
  useEffect(() => {
    let frame = 0;
    function measure() {
      frame = 0;
      const element = ref.current;
      if (!element) return;
      const distance = element.offsetHeight - window.innerHeight;
      const progress = distance > 0 ? -element.getBoundingClientRect().top / distance : 1;
      onProgress(Math.min(Math.max(progress, 0), 1));
    }
    function schedule() {
      if (!frame) frame = requestAnimationFrame(measure);
    }
    measure();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      cancelAnimationFrame(frame);
    };
  }, [ref, onProgress]);
}
