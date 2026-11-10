import { describe, expect, it } from "vitest";
import {
  MAX_PHOTO_BYTES,
  detectPhotoType,
  fullPhotoPath,
  moveToFront,
  readPhotoUpload,
  readPhotoUploads,
  readPrimaryPhoto,
  thumbnailPathOf,
} from "@/features/products/photo";

describe("thumbnailPathOf", () => {
  it("menurunkan path versi kecil dari foto olahan", () => {
    expect(thumbnailPathOf(fullPhotoPath("bisnis/abc"))).toBe("bisnis/abc-thumb.webp");
  });

  it("foto lama tidak punya versi kecil", () => {
    expect(thumbnailPathOf("bisnis/abc.jpg")).toBeNull();
    expect(thumbnailPathOf("bisnis/abc.webp")).toBeNull();
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
    await expect(readPhotoUpload(file)).resolves.toEqual({ kind: "invalid", message: "Ukuran foto maksimal 10MB" });
  });

  it("memakai tipe dari isi file, bukan dari kiriman browser", async () => {
    const file = new File([new Uint8Array(PNG)], "foto.jpg", { type: "image/jpeg" });
    await expect(readPhotoUpload(file)).resolves.toMatchObject({
      kind: "ok",
      photo: { contentType: "image/png", extension: "png" },
    });
  });
});

describe("readPhotoUploads", () => {
  const png = (name: string) => new File([new Uint8Array(PNG)], name, { type: "image/png" });

  it("membaca semua foto berurutan dan mengabaikan input kosong", async () => {
    const result = await readPhotoUploads([png("a.png"), new File([], ""), new File([new Uint8Array(JPEG)], "b.jpg")]);
    expect(result.kind === "ok" ? result.photos.map((photo) => photo.extension) : result).toEqual(["png", "jpg"]);
  });

  it("menolak lebih dari 5 foto", async () => {
    const files = Array.from({ length: 6 }, (_, index) => png(`${index}.png`));
    await expect(readPhotoUploads(files)).resolves.toEqual({ kind: "invalid", message: "Maksimal 5 foto per produk" });
  });

  it("memakai sisa slot sebagai batas", async () => {
    await expect(readPhotoUploads([png("a.png"), png("b.png")], 1)).resolves.toMatchObject({ kind: "invalid" });
  });

  it("satu file tidak valid membatalkan semuanya", async () => {
    const html = new File(["<html>"], "c.jpg", { type: "image/jpeg" });
    await expect(readPhotoUploads([png("a.png"), html])).resolves.toMatchObject({ kind: "invalid" });
  });
});

describe("readPrimaryPhoto", () => {
  it("membaca foto lama lewat path dan foto baru lewat urutan", () => {
    expect(readPrimaryPhoto("keep:bisnis/foto-full.webp")).toEqual({ kind: "keep", path: "bisnis/foto-full.webp" });
    expect(readPrimaryPhoto("new:2")).toEqual({ kind: "new", index: 2 });
  });

  it("nilai kosong atau tidak dikenal berarti tidak memilih", () => {
    for (const value of [null, "", "keep:", "new:", "new:-1", "new:abc", "lain"]) expect(readPrimaryPhoto(value)).toBeNull();
    expect(readPrimaryPhoto(new File(["x"], "x.txt"))).toBeNull();
  });
});

describe("moveToFront", () => {
  it("memindah item ke depan tanpa mengubah urutan lainnya", () => {
    expect(moveToFront(["a", "b", "c", "d"], 2)).toEqual(["c", "a", "b", "d"]);
    expect(moveToFront(["a", "b"], 0)).toEqual(["a", "b"]);
  });

  it("indeks di luar daftar menghasilkan null", () => {
    expect(moveToFront(["a"], 1)).toBeNull();
    expect(moveToFront(["a"], -1)).toBeNull();
    expect(moveToFront([], 0)).toBeNull();
  });
});
