export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
export const PHOTO_ACCEPT = "image/jpeg,image/png,image/webp";
export const PHOTO_TOO_LARGE_MESSAGE = "Ukuran foto maksimal 5MB";

const PHOTO_INVALID_MESSAGE = "Foto harus berformat JPG, PNG, atau WebP";
const PHOTO_REQUIRED_MESSAGE = "Foto produk wajib diisi";

export type PhotoUpload = { bytes: Uint8Array; contentType: string; extension: string };
export type PhotoReadResult = { kind: "none" } | { kind: "invalid"; message: string } | { kind: "ok"; photo: PhotoUpload };

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  return signature.every((byte, index) => bytes[offset + index] === byte);
}

const ASCII_RIFF = [0x52, 0x49, 0x46, 0x46];
const ASCII_WEBP = [0x57, 0x45, 0x42, 0x50];

/** Tipe ditentukan dari isi file, bukan nama atau tipe kiriman browser yang bisa dipalsukan. */
export function detectPhotoType(bytes: Uint8Array): Pick<PhotoUpload, "contentType" | "extension"> | null {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return { contentType: "image/jpeg", extension: "jpg" };
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { contentType: "image/png", extension: "png" };
  }
  if (startsWith(bytes, ASCII_RIFF) && startsWith(bytes, ASCII_WEBP, 8)) {
    return { contentType: "image/webp", extension: "webp" };
  }
  return null;
}

/** Browser mengirim File kosong saat input foto tidak diisi, sehingga ukuran 0 berarti tidak ada foto. */
export async function readPhotoUpload(value: FormDataEntryValue | null): Promise<PhotoReadResult> {
  if (!(value instanceof File) || value.size === 0) return { kind: "none" };
  if (value.size > MAX_PHOTO_BYTES) return { kind: "invalid", message: PHOTO_TOO_LARGE_MESSAGE };

  const bytes = new Uint8Array(await value.arrayBuffer());
  const type = detectPhotoType(bytes);
  if (!type) return { kind: "invalid", message: PHOTO_INVALID_MESSAGE };
  return { kind: "ok", photo: { bytes, ...type } };
}

/** Foto wajib saat produk dibuat, supaya setiap produk baru punya tampilan untuk pembeli. */
export function requirePhoto(result: PhotoReadResult): PhotoReadResult {
  return result.kind === "none" ? { kind: "invalid", message: PHOTO_REQUIRED_MESSAGE } : result;
}
