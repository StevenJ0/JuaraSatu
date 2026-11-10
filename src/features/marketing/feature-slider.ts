/**
 * Hitungan geser kartu fitur di HP: gulir vertikal 0..1 menjadi posisi kartu (0 = kartu pertama, n-1 = terakhir).
 * Di awal dan akhir ada jeda agar kartu pertama dan terakhir sempat terbaca, dan di setiap kartu posisinya menahan sebentar
 * (bagian datar) sebelum bergeser dengan percepatan dan perlambatan halus.
 */

/** Bagian awal gulir sebelum kartu pertama mulai bergeser. */
export const SLIDER_LEAD = 0.04;
/** Bagian akhir gulir setelah kartu terakhir tiba, sebelum halaman lanjut. */
export const SLIDER_TAIL = 0.1;
/** Di setiap perpindahan, sebagian di awal dan akhir dipakai untuk menahan kartu tetap diam. */
const PLATEAU = 0.2;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function sliderPosition(progress: number, count: number): number {
  const span = count - 1;
  if (span <= 0) return 0;
  const travel = clamp((progress - SLIDER_LEAD) / (1 - SLIDER_LEAD - SLIDER_TAIL), 0, 1) * span;
  const index = Math.min(Math.floor(travel), span - 1);
  const step = clamp((travel - index - PLATEAU) / (1 - 2 * PLATEAU), 0, 1);
  return index + step * step * (3 - 2 * step);
}

/** Titik gulir (0..1) tempat kartu `index` tampil penuh dan diam; dipakai saat tab fitur ditekan. */
export function sliderProgressFor(index: number, count: number): number {
  const span = count - 1;
  if (span <= 0) return 0;
  return SLIDER_LEAD + (clamp(index, 0, span) / span) * (1 - SLIDER_LEAD - SLIDER_TAIL);
}

/** Geseran jari minimal agar dianggap pindah kartu, bukan ketukan atau gerakan tak sengaja. */
export const SWIPE_MIN_PX = 40;
/** Geseran harus lebih mendatar daripada tegak, agar gulir halaman ke bawah tidak terbaca sebagai geser kartu. */
const SWIPE_HORIZONTAL_RATIO = 1.2;
const DRAG_FOLLOW = 0.5;
const DRAG_EDGE_FOLLOW = 0.15;
const DRAG_MAX_PX = 120;

/** 1 = ke kartu berikutnya (jari ke kiri), -1 = ke kartu sebelumnya (jari ke kanan), 0 = bukan geser kartu. */
export function swipeDirection(deltaX: number, deltaY: number): -1 | 0 | 1 {
  if (Math.abs(deltaX) < SWIPE_MIN_PX || Math.abs(deltaX) < Math.abs(deltaY) * SWIPE_HORIZONTAL_RATIO) return 0;
  return deltaX < 0 ? 1 : -1;
}

/** Seberapa jauh kartu mengikuti jari saat digeser; di kartu pertama dan terakhir hanya sedikit, seperti tertahan karet. */
export function dragOffset(deltaX: number, index: number, count: number): number {
  const pastEdge = (deltaX > 0 && index <= 0) || (deltaX < 0 && index >= count - 1);
  return clamp(deltaX * (pastEdge ? DRAG_EDGE_FOLLOW : DRAG_FOLLOW), -DRAG_MAX_PX, DRAG_MAX_PX);
}
