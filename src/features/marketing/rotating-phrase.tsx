"use client";

import { Fragment, useEffect, useState, type CSSProperties } from "react";
import styles from "./landing.module.css";

/** Waktu satu kalimat tampil diam sebelum berganti. */
const HOLD_MS = 2800;
/** Harus sama dengan durasi animasi huruf di CSS (.flipIn/.flipOut); tiap huruf berikutnya mulai STAGGER_MS kemudian. */
const LETTER_MS = 620;
const STAGGER_MS = 28;

type RotationState = { current: number; previous: number | null };

/**
 * Kalimat berwarna di judul yang berganti seperti balok berputar: tiap huruf berguling dari atas ke bawah, bergantian dari
 * kiri ke kanan. Semua kalimat ditumpuk tak terlihat di sel yang sama, jadi ukuran judul tidak berubah saat berganti.
 * Pembaca layar hanya membaca kalimat pertama (lewat teks tersembunyi di judul), dan pengguna yang mematikan animasi
 * melihat kalimat pertama saja.
 */
export function RotatingPhrase({ phrases }: { phrases: readonly string[] }) {
  const [{ current, previous }, setRotation] = useState<RotationState>({ current: 0, previous: null });
  const count = phrases.length;

  useEffect(() => {
    if (count < 2 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setInterval(() => {
      // Di tab yang tidak terlihat animasi tidak berjalan, jadi kalimat tidak perlu diganti.
      if (document.hidden) return;
      setRotation((state) => ({ current: (state.current + 1) % count, previous: state.current }));
    }, HOLD_MS + LETTER_MS);
    return () => window.clearInterval(timer);
  }, [count]);

  // Kalimat lama dilepas setelah huruf terakhirnya selesai berguling keluar.
  useEffect(() => {
    if (previous === null) return;
    const letters = (phrases[previous] ?? "").replaceAll(" ", "").length;
    const timer = window.setTimeout(() => setRotation((state) => ({ ...state, previous: null })), LETTER_MS + letters * STAGGER_MS);
    return () => window.clearTimeout(timer);
  }, [previous, phrases]);

  return (
    <span className={styles.rotating} aria-hidden="true">
      {phrases.map((phrase) => (
        <span key={phrase} className={styles.rotatingSizer}>{phrase}</span>
      ))}
      {previous !== null && <Letters key={`out-${previous}-${current}`} text={phrases[previous] ?? ""} mode="out" />}
      <Letters key={`in-${current}`} text={phrases[current] ?? ""} mode={previous === null ? "still" : "in"} />
    </span>
  );
}

/** Kata dengan posisi huruf pertamanya di seluruh kalimat, untuk jeda bertahap yang berlanjut antarkata. */
function wordsWithOffsets(text: string): { word: string; start: number }[] {
  const words = text.split(" ");
  return words.map((word, index) => ({ word, start: words.slice(0, index).join("").length }));
}

/** Huruf per huruf di dalam kata yang tidak terpotong, agar kalimat tetap bisa turun baris di antara kata pada layar sempit. */
function Letters({ text, mode }: { text: string; mode: "in" | "out" | "still" }) {
  const animation = mode === "in" ? styles.flipIn : mode === "out" ? styles.flipOut : "";
  return (
    <span className={styles.rotatingLine}>
      {wordsWithOffsets(text).map(({ word, start }, wordIndex) => (
        <Fragment key={`${word}-${start}`}>
          {wordIndex > 0 && " "}
          <span className={styles.rotatingWord}>
            {Array.from(word).map((letter, letterIndex) => (
              <span key={letterIndex} className={`${styles.letter} ${animation}`} style={{ "--i": start + letterIndex } as CSSProperties}>
                {letter}
              </span>
            ))}
          </span>
        </Fragment>
      ))}
    </span>
  );
}
