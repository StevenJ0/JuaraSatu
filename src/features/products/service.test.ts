import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ProductRepositoryError,
  findProduct,
  insertProduct,
  removeProductPhoto,
  updateProduct,
  uploadProductPhoto,
  type Product,
} from "@/features/products/repository";
import { createProductWithPhotos, updateProductWithPhotos } from "@/features/products/service";

vi.mock("@/features/products/repository", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/features/products/repository")>();
  return {
    ...original,
    findProduct: vi.fn(),
    insertProduct: vi.fn(),
    updateProduct: vi.fn(),
    uploadProductPhoto: vi.fn(),
    removeProductPhoto: vi.fn(),
  };
});

const find = vi.mocked(findProduct);
const insert = vi.mocked(insertProduct);
const update = vi.mocked(updateProduct);
const upload = vi.mocked(uploadProductPhoto);
const remove = vi.mocked(removeProductPhoto);

// Repository di-mock sehingga client tidak pernah dipakai.
const client = {} as SupabaseClient;
const BUSINESS_ID = "22222222-2222-4222-8222-222222222222";
const PRODUCT_ID = "33333333-3333-4333-8333-333333333333";
const OLD_PATH = `${BUSINESS_ID}/lama.jpg`;
const OLD_GALLERY_PATH = `${BUSINESS_ID}/lama-2.jpg`;
const NEW_PATH = `${BUSINESS_ID}/baru.jpg`;
const NEW_PATH_2 = `${BUSINESS_ID}/baru-2.jpg`;
const photo = { full: new Uint8Array([1]), thumbnail: new Uint8Array([2]) };
const input = {
  name: "Brownies",
  description: null,
  basePriceIdr: 25000,
  variableCostIdr: null,
  costQuality: "unknown" as const,
};
const photoOf = (path: string) => ({ path, url: path, thumbnailUrl: path });
const current: Product = {
  id: PRODUCT_ID,
  name: "Brownies",
  description: null,
  photoPath: OLD_PATH,
  photoUrl: null,
  thumbnailUrl: null,
  photos: [photoOf(OLD_PATH), photoOf(OLD_GALLERY_PATH)],
  basePriceIdr: 20000,
  variableCostIdr: null,
  costQuality: "unknown",
  isActive: true,
  version: 3,
};

const duplicateSku = () => new ProductRepositoryError("insertProduct", "23505");

describe("createProductWithPhotos", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("menyimpan path foto yang diunggah sesuai urutan", async () => {
    upload.mockResolvedValueOnce(NEW_PATH).mockResolvedValueOnce(NEW_PATH_2);
    await createProductWithPhotos(client, BUSINESS_ID, input, [photo, photo]);
    expect(insert.mock.calls[0]?.[4]).toEqual([NEW_PATH, NEW_PATH_2]);
  });

  it("menolak tanpa foto atau lebih dari 5 foto tanpa mengunggah", async () => {
    await expect(createProductWithPhotos(client, BUSINESS_ID, input, [])).rejects.toBeInstanceOf(ProductRepositoryError);
    await expect(createProductWithPhotos(client, BUSINESS_ID, input, Array(6).fill(photo))).rejects.toBeInstanceOf(
      ProductRepositoryError,
    );
    expect(upload).not.toHaveBeenCalled();
  });

  it("membuang foto yang sudah terunggah bila unggahan berikutnya gagal", async () => {
    upload.mockResolvedValueOnce(NEW_PATH).mockRejectedValueOnce(new ProductRepositoryError("uploadProductPhoto", "x"));
    await expect(createProductWithPhotos(client, BUSINESS_ID, input, [photo, photo])).rejects.toBeInstanceOf(
      ProductRepositoryError,
    );
    expect(remove).toHaveBeenCalledWith(client, NEW_PATH);
    expect(insert).not.toHaveBeenCalled();
  });

  it("membuat SKU dari nama produk", async () => {
    upload.mockResolvedValue(NEW_PATH);
    await createProductWithPhotos(client, BUSINESS_ID, input, [photo]);
    expect(insert.mock.calls[0]?.[3]).toMatch(/^BROWNIES-[A-Z0-9]{6}$/);
  });

  it("mencoba SKU baru saat bentrok dan tidak mengunggah foto dua kali", async () => {
    upload.mockResolvedValue(NEW_PATH);
    insert.mockRejectedValueOnce(duplicateSku()).mockResolvedValueOnce();
    await createProductWithPhotos(client, BUSINESS_ID, input, [photo]);
    expect(insert).toHaveBeenCalledTimes(2);
    expect(insert.mock.calls[0]?.[3]).not.toBe(insert.mock.calls[1]?.[3]);
    expect(upload).toHaveBeenCalledTimes(1);
    expect(remove).not.toHaveBeenCalled();
  });

  it("berhenti setelah 3 kali bentrok dan membuang semua foto", async () => {
    upload.mockResolvedValueOnce(NEW_PATH).mockResolvedValueOnce(NEW_PATH_2);
    insert.mockRejectedValue(duplicateSku());
    await expect(createProductWithPhotos(client, BUSINESS_ID, input, [photo, photo])).rejects.toMatchObject({
      isDuplicateSku: true,
    });
    expect(insert).toHaveBeenCalledTimes(3);
    expect(remove).toHaveBeenCalledWith(client, NEW_PATH);
    expect(remove).toHaveBeenCalledWith(client, NEW_PATH_2);
  });

  it("tidak mencoba ulang untuk error selain bentrok SKU", async () => {
    upload.mockResolvedValue(NEW_PATH);
    insert.mockRejectedValue(new ProductRepositoryError("insertProduct", "42501"));
    await expect(createProductWithPhotos(client, BUSINESS_ID, input, [photo])).rejects.toThrow(/42501/);
    expect(insert).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith(client, NEW_PATH);
  });
});

describe("updateProductWithPhotos", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    find.mockResolvedValue(current);
    update.mockResolvedValue(true);
    upload.mockResolvedValue(NEW_PATH);
  });

  const run = (photoChange: Parameters<typeof updateProductWithPhotos>[5], version = 3) =>
    updateProductWithPhotos(client, BUSINESS_ID, PRODUCT_ID, version, input, photoChange);
  const keepAll = { keep: [OLD_PATH, OLD_GALLERY_PATH], add: [] };

  it("melapor not_found untuk produk di luar business ini", async () => {
    find.mockResolvedValue(null);
    await expect(run(keepAll)).resolves.toBe("not_found");
    expect(update).not.toHaveBeenCalled();
  });

  it("tidak mengunggah apa pun bila versi sudah kedaluwarsa", async () => {
    await expect(run({ keep: [OLD_PATH], add: [photo] }, 2)).resolves.toBe("conflict");
    expect(upload).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("mempertahankan semua foto lama", async () => {
    await expect(run(keepAll)).resolves.toBe("updated");
    expect(update).toHaveBeenCalledWith(client, BUSINESS_ID, PRODUCT_ID, 3, input, [OLD_PATH, OLD_GALLERY_PATH]);
    expect(remove).not.toHaveBeenCalled();
  });

  it("menambah foto baru di belakang foto lama", async () => {
    await expect(run({ keep: [OLD_PATH, OLD_GALLERY_PATH], add: [photo] })).resolves.toBe("updated");
    expect(update).toHaveBeenCalledWith(client, BUSINESS_ID, PRODUCT_ID, 3, input, [OLD_PATH, OLD_GALLERY_PATH, NEW_PATH]);
  });

  it("foto galeri yang dipertahankan bisa menjadi foto utama", async () => {
    await expect(run({ keep: [OLD_GALLERY_PATH], add: [] })).resolves.toBe("updated");
    expect(update.mock.calls[0]?.[5]).toEqual([OLD_GALLERY_PATH]);
    expect(remove).toHaveBeenCalledWith(client, OLD_PATH);
  });

  it("foto baru yang dipilih menjadi foto utama, urutan foto lain tetap", async () => {
    upload.mockResolvedValueOnce(NEW_PATH).mockResolvedValueOnce(NEW_PATH_2);
    await expect(run({ keep: [OLD_PATH, OLD_GALLERY_PATH], add: [photo, photo], primary: { kind: "new", index: 1 } })).resolves.toBe("updated");
    expect(update.mock.calls[0]?.[5]).toEqual([NEW_PATH_2, OLD_PATH, OLD_GALLERY_PATH, NEW_PATH]);
  });

  it("foto lama yang dipilih menjadi foto utama", async () => {
    await expect(run({ ...keepAll, primary: { kind: "keep", path: OLD_GALLERY_PATH } })).resolves.toBe("updated");
    expect(update.mock.calls[0]?.[5]).toEqual([OLD_GALLERY_PATH, OLD_PATH]);
  });

  it("menolak pilihan foto utama yang tidak ada di perubahan, sebelum mengunggah", async () => {
    await expect(run({ keep: [OLD_PATH], add: [photo], primary: { kind: "keep", path: OLD_GALLERY_PATH } })).resolves.toBe("invalid_photos");
    await expect(run({ keep: [OLD_PATH], add: [photo], primary: { kind: "new", index: 1 } })).resolves.toBe("invalid_photos");
    expect(upload).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("menolak path foto yang bukan milik produk ini", async () => {
    await expect(run({ keep: [`${BUSINESS_ID}/milik-lain.jpg`], add: [] })).resolves.toBe("invalid_photos");
    expect(update).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
  });

  it("menolak hasil tanpa foto atau lebih dari 5 foto", async () => {
    await expect(run({ keep: [], add: [] })).resolves.toBe("invalid_photos");
    await expect(run({ keep: [OLD_PATH, OLD_GALLERY_PATH], add: Array(4).fill(photo) })).resolves.toBe("invalid_photos");
    expect(upload).not.toHaveBeenCalled();
  });

  it("menghapus foto lama setelah baris tidak lagi menunjuknya", async () => {
    await expect(run({ keep: [], add: [photo] })).resolves.toBe("updated");
    expect(update).toHaveBeenCalledWith(client, BUSINESS_ID, PRODUCT_ID, 3, input, [NEW_PATH]);
    expect(remove).toHaveBeenCalledTimes(2);
    expect(remove).toHaveBeenCalledWith(client, OLD_PATH);
    expect(remove).toHaveBeenCalledWith(client, OLD_GALLERY_PATH);
    expect(update.mock.invocationCallOrder[0]).toBeLessThan(remove.mock.invocationCallOrder[0] ?? 0);
  });

  it("membuang foto baru dan menjaga foto lama bila kalah balapan versi", async () => {
    update.mockResolvedValue(false);
    await expect(run({ keep: [OLD_PATH], add: [photo] })).resolves.toBe("conflict");
    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith(client, NEW_PATH);
  });

  it("membuang foto baru bila simpan error, lalu meneruskan error", async () => {
    update.mockRejectedValue(new ProductRepositoryError("updateProduct", "23514"));
    await expect(run({ keep: [OLD_PATH], add: [photo] })).rejects.toBeInstanceOf(ProductRepositoryError);
    expect(remove).toHaveBeenCalledWith(client, NEW_PATH);
  });

  it("tetap sukses bila hapus foto lama gagal", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    remove.mockRejectedValue(new ProductRepositoryError("removeProductPhoto", "StorageApiError"));
    await expect(run({ keep: [], add: [photo] })).resolves.toBe("updated");
  });
});
