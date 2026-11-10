import { describe, expect, it } from "vitest";
import {
  CROP_MAX_ZOOM,
  CROP_OUTPUT_MAX_SIDE_PX,
  clampCrop,
  cropImageBox,
  cropOutputSide,
  cropSourceRect,
  initialCrop,
  panCrop,
} from "@/features/products/photo-crop";

const landscape = { width: 4000, height: 3000 };

describe("crop persegi foto produk", () => {
  it("awalnya mengambil persegi terbesar di tengah foto", () => {
    expect(cropSourceRect(landscape, initialCrop(landscape))).toEqual({ x: 500, y: 0, side: 3000 });
  });

  it("hasil dibatasi 1600px dan tidak diperbesar dari foto kecil", () => {
    expect(cropOutputSide(landscape, initialCrop(landscape))).toBe(CROP_OUTPUT_MAX_SIDE_PX);
    const small = { width: 500, height: 400 };
    expect(cropOutputSide(small, initialCrop(small))).toBe(400);
    expect(cropOutputSide(small, clampCrop(small, { ...initialCrop(small), zoom: 2 }))).toBe(200);
  });

  it("kotak tidak pernah keluar dari foto", () => {
    expect(clampCrop(landscape, { zoom: 1, centerX: 0, centerY: 9999 })).toEqual({ zoom: 1, centerX: 1500, centerY: 1500 });
    expect(clampCrop(landscape, { zoom: 99, centerX: 2000, centerY: 1500 }).zoom).toBe(CROP_MAX_ZOOM);
    expect(clampCrop(landscape, { zoom: 0.2, centerX: 2000, centerY: 1500 }).zoom).toBe(1);
  });

  it("seretan ke kanan memperlihatkan bagian kiri foto, sebanding dengan zoom", () => {
    const start = initialCrop(landscape);
    // Kotak 300px menampilkan 3000px foto, jadi 1px layar = 10px foto.
    expect(panCrop(landscape, start, 30, 0, 300).centerX).toBe(1700);
    const zoomed = clampCrop(landscape, { ...start, zoom: 2 });
    expect(panCrop(landscape, zoomed, 30, 0, 300).centerX).toBe(1850);
    expect(panCrop(landscape, start, 30, 0, 0)).toBe(start);
  });

  it("posisi gambar dalam persen terhadap kotak", () => {
    const box = cropImageBox(landscape, initialCrop(landscape));
    expect(box.left).toBeCloseTo(-16.667, 3);
    expect(box.top).toBeCloseTo(0, 6);
    expect(box.width).toBeCloseTo(133.333, 3);
    expect(box.height).toBeCloseTo(100, 6);
  });
});
