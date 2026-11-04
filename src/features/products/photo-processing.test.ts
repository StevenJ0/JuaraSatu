import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { optimizeProductPhoto } from "@/features/products/photo-processing";

const WHITE = { r: 255, g: 255, b: 255 };

function solidImage(width: number, height: number) {
  return sharp({ create: { width, height, channels: 3, background: WHITE } });
}

async function optimized(source: Uint8Array) {
  const files = await optimizeProductPhoto(source);
  if (!files) throw new Error("foto seharusnya bisa diproses");
  return files;
}

describe("optimizeProductPhoto", () => {
  it("membuang metadata, termasuk yang bisa memuat lokasi", async () => {
    const marker = "RUMAH-PEMILIK-UJI";
    const source = await solidImage(100, 100)
      .withExif({ IFD0: { Copyright: marker }, IFD3: { GPSLatitudeRef: "S", GPSProcessingMethod: marker } })
      .jpeg()
      .toBuffer();
    expect(source.includes(marker)).toBe(true);

    const { full, thumbnail } = await optimized(source);
    for (const output of [full, thumbnail]) {
      expect(Buffer.from(output).includes(marker)).toBe(false);
      const metadata = await sharp(output).metadata();
      expect(metadata.exif).toBeUndefined();
      expect(metadata.xmp).toBeUndefined();
      expect(metadata.iptc).toBeUndefined();
    }
  });

  it("memutar foto sesuai orientasi sebelum metadatanya dibuang", async () => {
    const source = await solidImage(400, 200).withMetadata({ orientation: 6 }).jpeg().toBuffer();
    const metadata = await sharp((await optimized(source)).full).metadata();
    expect([metadata.width, metadata.height]).toEqual([200, 400]);
    expect(metadata.orientation).toBeUndefined();
  });

  it("mengecilkan foto besar dengan perbandingan yang sama", async () => {
    const source = await solidImage(4032, 3024).jpeg().toBuffer();
    const metadata = await sharp((await optimized(source)).full).metadata();
    expect(metadata.format).toBe("webp");
    expect([metadata.width, metadata.height]).toEqual([1600, 1200]);
  });

  it("tidak memperbesar foto kecil", async () => {
    const source = await solidImage(300, 200).png().toBuffer();
    const metadata = await sharp((await optimized(source)).full).metadata();
    expect([metadata.width, metadata.height]).toEqual([300, 200]);
  });

  it("membuat versi kecil berbentuk persegi", async () => {
    const source = await solidImage(1200, 800).jpeg().toBuffer();
    const metadata = await sharp((await optimized(source)).thumbnail).metadata();
    expect(metadata.format).toBe("webp");
    expect([metadata.width, metadata.height]).toEqual([320, 320]);
  });

  it("mempertahankan transparansi PNG", async () => {
    const source = await sharp({ create: { width: 50, height: 50, channels: 4, background: { ...WHITE, alpha: 0 } } }).png().toBuffer();
    expect((await sharp((await optimized(source)).full).metadata()).hasAlpha).toBe(true);
  });

  it("menolak file yang bukan gambar utuh", async () => {
    await expect(optimizeProductPhoto(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]))).resolves.toBeNull();
  });

  it("menolak gambar yang mengaku berukuran raksasa", async () => {
    const header = Buffer.alloc(33);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]).copy(header);
    header.writeUInt32BE(20000, 16);
    header.writeUInt32BE(20000, 20);
    header.set([8, 2, 0, 0, 0], 24);
    await expect(optimizeProductPhoto(header)).resolves.toBeNull();
  });
});
