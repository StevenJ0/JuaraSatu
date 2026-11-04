import { describe, expect, it } from "vitest";
import { MAX_PHOTO_BYTES, detectPhotoType, readPhotoUpload, requirePhoto } from "@/features/products/photo";

describe("requirePhoto", () => {
  it("menolak bila foto tidak ada", () => {
    expect(requirePhoto({ kind: "none" })).toEqual({ kind: "invalid", message: "Foto produk wajib diisi" });
  });

  it("tidak mengubah hasil yang lain", () => {
    const invalid = { kind: "invalid", message: "Ukuran foto maksimal 5MB" } as const;
    expect(requirePhoto(invalid)).toBe(invalid);
    const ok = { kind: "ok", photo: { bytes: new Uint8Array(), contentType: "image/png", extension: "png" } } as const;
    expect(requirePhoto(ok)).toBe(ok);
  });
});

const JPEG = [0xff, 0xd8, 0xff, 0xe0, 0x00];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00];
const WEBP = [0x52, 0x49, 0x46, 0x46, 0x01, 0x02, 0x03, 0x04, 0x57, 0x45, 0x42, 0x50];

describe("detectPhotoType", () => {
  it.each([
    [JPEG, "jpg"],
    [PNG, "png"],
    [WEBP, "webp"],
  ])("mengenali isi file %#", (bytes, extension) => {
    expect(detectPhotoType(new Uint8Array(bytes))?.extension).toBe(extension);
  });

  it("menolak RIFF yang bukan WebP dan file pendek", () => {
    expect(detectPhotoType(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x41, 0x56, 0x49, 0x20]))).toBeNull();
    expect(detectPhotoType(new Uint8Array([0xff]))).toBeNull();
  });
});

describe("readPhotoUpload", () => {
  it("menganggap input kosong sebagai tidak ada foto", async () => {
    await expect(readPhotoUpload(null)).resolves.toEqual({ kind: "none" });
    await expect(readPhotoUpload(new File([], ""))).resolves.toEqual({ kind: "none" });
    await expect(readPhotoUpload("teks")).resolves.toEqual({ kind: "none" });
  });

  it("menolak file berisi HTML walau mengaku JPEG", async () => {
    const file = new File(["<script>alert(1)</script>"], "foto.jpg", { type: "image/jpeg" });
    await expect(readPhotoUpload(file)).resolves.toMatchObject({ kind: "invalid" });
  });

  it("menolak file melebihi batas ukuran", async () => {
    const file = new File([new Uint8Array(MAX_PHOTO_BYTES + 1)], "besar.jpg", { type: "image/jpeg" });
    await expect(readPhotoUpload(file)).resolves.toEqual({ kind: "invalid", message: "Ukuran foto maksimal 5MB" });
  });

  it("memakai tipe dari isi file, bukan dari kiriman browser", async () => {
    const file = new File([new Uint8Array(PNG)], "foto.jpg", { type: "image/jpeg" });
    await expect(readPhotoUpload(file)).resolves.toMatchObject({
      kind: "ok",
      photo: { contentType: "image/png", extension: "png" },
    });
  });
});
