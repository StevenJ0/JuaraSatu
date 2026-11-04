import "server-only";
import sharp from "sharp";

const FULL_MAX_SIDE_PX = 1600;
const FULL_QUALITY = 82;
// Daftar produk menampilkan 64px; 320px tetap tajam di layar HP berkepadatan tinggi.
const THUMBNAIL_SIDE_PX = 320;
const THUMBNAIL_QUALITY = 78;
// Mencegah file kecil yang mengembang menjadi gambar raksasa saat dibuka dan menghabiskan memori server.
const MAX_INPUT_PIXELS = 100_000_000;

export type ProductPhotoFiles = { full: Uint8Array; thumbnail: Uint8Array };

/**
 * Hasilnya tanpa metadata karena sharp tidak menyalinnya secara bawaan; foto HP bisa memuat lokasi GPS, sedangkan bucket
 * foto produk publik. `rotate()` wajib lebih dulu: arah foto HP tersimpan di metadata yang akan dibuang.
 * Mengembalikan null bila file tidak bisa dibaca sebagai gambar.
 */
export async function optimizeProductPhoto(source: Uint8Array): Promise<ProductPhotoFiles | null> {
  try {
    const image = sharp(source, { limitInputPixels: MAX_INPUT_PIXELS }).rotate();
    const [full, thumbnail] = await Promise.all([
      image
        .clone()
        .resize({ width: FULL_MAX_SIDE_PX, height: FULL_MAX_SIDE_PX, fit: "inside", withoutEnlargement: true })
        .webp({ quality: FULL_QUALITY })
        .toBuffer(),
      image
        .clone()
        .resize({ width: THUMBNAIL_SIDE_PX, height: THUMBNAIL_SIDE_PX, fit: "cover" })
        .webp({ quality: THUMBNAIL_QUALITY })
        .toBuffer(),
    ]);
    return { full, thumbnail };
  } catch {
    return null;
  }
}
