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
import { createProductWithPhoto, updateProductWithPhoto } from "@/features/products/service";

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
const NEW_PATH = `${BUSINESS_ID}/baru.jpg`;
const photo = { full: new Uint8Array([1]), thumbnail: new Uint8Array([2]) };
const input = {
  name: "Brownies",
  description: null,
  basePriceIdr: 25000,
  variableCostIdr: null,
  costQuality: "unknown" as const,
};
const current: Product = {
  id: PRODUCT_ID,
  name: "Brownies",
  description: null,
  photoPath: OLD_PATH,
  photoUrl: null,
  thumbnailUrl: null,
  basePriceIdr: 20000,
  variableCostIdr: null,
  costQuality: "unknown",
  isActive: true,
  version: 3,
};

const duplicateSku = () => new ProductRepositoryError("insertProduct", "23505");

describe("createProductWithPhoto", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("menyimpan path foto yang diunggah", async () => {
    upload.mockResolvedValue(NEW_PATH);
    await createProductWithPhoto(client, BUSINESS_ID, input, photo);
    expect(insert.mock.calls[0]?.[4]).toBe(NEW_PATH);
  });

  it("membuat SKU dari nama produk", async () => {
    upload.mockResolvedValue(NEW_PATH);
    await createProductWithPhoto(client, BUSINESS_ID, input, photo);
    expect(insert.mock.calls[0]?.[3]).toMatch(/^BROWNIES-[A-Z0-9]{6}$/);
  });

  it("mencoba SKU baru saat bentrok dan tidak mengunggah foto dua kali", async () => {
    upload.mockResolvedValue(NEW_PATH);
    insert.mockRejectedValueOnce(duplicateSku()).mockResolvedValueOnce();
    await createProductWithPhoto(client, BUSINESS_ID, input, photo);
    expect(insert).toHaveBeenCalledTimes(2);
    expect(insert.mock.calls[0]?.[3]).not.toBe(insert.mock.calls[1]?.[3]);
    expect(upload).toHaveBeenCalledTimes(1);
    expect(remove).not.toHaveBeenCalled();
  });

  it("berhenti setelah 3 kali bentrok dan membuang foto", async () => {
    upload.mockResolvedValue(NEW_PATH);
    insert.mockRejectedValue(duplicateSku());
    await expect(createProductWithPhoto(client, BUSINESS_ID, input, photo)).rejects.toMatchObject({ isDuplicateSku: true });
    expect(insert).toHaveBeenCalledTimes(3);
    expect(remove).toHaveBeenCalledWith(client, NEW_PATH);
  });

  it("tidak mencoba ulang untuk error selain bentrok SKU", async () => {
    upload.mockResolvedValue(NEW_PATH);
    insert.mockRejectedValue(new ProductRepositoryError("insertProduct", "42501"));
    await expect(createProductWithPhoto(client, BUSINESS_ID, input, photo)).rejects.toThrow(/42501/);
    expect(insert).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith(client, NEW_PATH);
  });
});

describe("updateProductWithPhoto", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    find.mockResolvedValue(current);
    update.mockResolvedValue(true);
    upload.mockResolvedValue(NEW_PATH);
  });

  const run = (photoChange: Parameters<typeof updateProductWithPhoto>[5], version = 3) =>
    updateProductWithPhoto(client, BUSINESS_ID, PRODUCT_ID, version, input, photoChange);

  it("melapor not_found untuk produk di luar business ini", async () => {
    find.mockResolvedValue(null);
    await expect(run({ kind: "keep" })).resolves.toBe("not_found");
    expect(update).not.toHaveBeenCalled();
  });

  it("tidak mengunggah apa pun bila versi sudah kedaluwarsa", async () => {
    await expect(run({ kind: "replace", photo }, 2)).resolves.toBe("conflict");
    expect(upload).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("mempertahankan foto lama saat keep", async () => {
    await expect(run({ kind: "keep" })).resolves.toBe("updated");
    expect(update).toHaveBeenCalledWith(client, BUSINESS_ID, PRODUCT_ID, 3, input, OLD_PATH);
    expect(remove).not.toHaveBeenCalled();
  });

  it("menghapus foto lama setelah baris menunjuk foto baru", async () => {
    await expect(run({ kind: "replace", photo })).resolves.toBe("updated");
    expect(update).toHaveBeenCalledWith(client, BUSINESS_ID, PRODUCT_ID, 3, input, NEW_PATH);
    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith(client, OLD_PATH);
    expect(update.mock.invocationCallOrder[0]).toBeLessThan(remove.mock.invocationCallOrder[0] ?? 0);
  });

  it("membuang foto baru dan menjaga foto lama bila kalah balapan versi", async () => {
    update.mockResolvedValue(false);
    await expect(run({ kind: "replace", photo })).resolves.toBe("conflict");
    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith(client, NEW_PATH);
  });

  it("membuang foto baru bila simpan error, lalu meneruskan error", async () => {
    update.mockRejectedValue(new ProductRepositoryError("updateProduct", "23505"));
    await expect(run({ kind: "replace", photo })).rejects.toBeInstanceOf(ProductRepositoryError);
    expect(remove).toHaveBeenCalledWith(client, NEW_PATH);
  });

  it("tetap sukses bila hapus foto lama gagal", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    remove.mockRejectedValue(new ProductRepositoryError("removeProductPhoto", "StorageApiError"));
    await expect(run({ kind: "replace", photo })).resolves.toBe("updated");
  });
});
