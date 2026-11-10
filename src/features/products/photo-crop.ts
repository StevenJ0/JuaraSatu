/**
 * Hitungan crop persegi untuk foto produk. Halaman pembeli dan daftar produk menampilkan foto persegi (1:1),
 * jadi area yang dipilih pemilik di sini sama persis dengan yang dilihat pembeli.
 * Posisi disimpan sebagai titik tengah dalam piksel foto asli agar tidak bergantung pada ukuran kotak di layar.
 */

/** Sama dengan sisi terpanjang foto yang disimpan server (`photo-processing.ts`); lebih besar dari ini hanya memperberat upload. */
export const CROP_OUTPUT_MAX_SIDE_PX = 1600;
export const CROP_MAX_ZOOM = 4;
/** Di bawah ini foto mulai terlihat buram di kolom foto halaman pembeli. */
export const LOW_RESOLUTION_SIDE_PX = 600;

export type ImageSize = { width: number; height: number };
export type CropState = { zoom: number; centerX: number; centerY: number };
export type CropRect = { x: number; y: number; side: number };

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Sisi pendek foto mengisi penuh kotak saat zoom 1. */
function shortSide(size: ImageSize): number {
  return Math.min(size.width, size.height);
}

export function initialCrop(size: ImageSize): CropState {
  return { zoom: 1, centerX: size.width / 2, centerY: size.height / 2 };
}

/** Menjaga zoom dalam batas dan memastikan kotak tidak pernah keluar dari foto. */
export function clampCrop(size: ImageSize, crop: CropState): CropState {
  const zoom = clamp(crop.zoom, 1, CROP_MAX_ZOOM);
  const half = shortSide(size) / zoom / 2;
  return {
    zoom,
    centerX: clamp(crop.centerX, half, size.width - half),
    centerY: clamp(crop.centerY, half, size.height - half),
  };
}

/** Menggeser foto mengikuti seretan sejauh `deltaX`/`deltaY` piksel layar pada kotak selebar `viewportPx`. */
export function panCrop(size: ImageSize, crop: CropState, deltaX: number, deltaY: number, viewportPx: number): CropState {
  if (viewportPx <= 0) return crop;
  const sourcePerScreenPx = shortSide(size) / crop.zoom / viewportPx;
  return clampCrop(size, { ...crop, centerX: crop.centerX - deltaX * sourcePerScreenPx, centerY: crop.centerY - deltaY * sourcePerScreenPx });
}

export function cropSourceRect(size: ImageSize, crop: CropState): CropRect {
  const side = shortSide(size) / crop.zoom;
  return { x: crop.centerX - side / 2, y: crop.centerY - side / 2, side };
}

export function cropOutputSide(size: ImageSize, crop: CropState): number {
  return Math.max(1, Math.min(Math.round(cropSourceRect(size, crop).side), CROP_OUTPUT_MAX_SIDE_PX));
}

/** Posisi dan ukuran foto dalam persen terhadap kotak crop, sehingga tampilan ikut menyesuaikan lebar layar. */
export function cropImageBox(size: ImageSize, crop: CropState): { left: number; top: number; width: number; height: number } {
  const scale = (crop.zoom / shortSide(size)) * 100;
  return { left: 50 - crop.centerX * scale, top: 50 - crop.centerY * scale, width: size.width * scale, height: size.height * scale };
}
