import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProductPhotoFiles } from "@/features/products/photo-processing";
import { MAX_PRODUCT_PHOTOS } from "@/features/products/photo";
import type { ProductInput } from "@/features/products/schemas";
import {
  ProductRepositoryError,
  findProduct,
  insertProduct,
  removeProductPhoto,
  updateProduct,
  uploadProductPhoto,
} from "@/features/products/repository";
import { createProductSku } from "@/features/products/sku";

const MAX_SKU_ATTEMPTS = 3;

/**
 * Perubahan foto saat edit: `keep` adalah foto lama yang dipertahankan (berurutan), `add` foto baru yang ditambahkan di belakang.
 * Hasil akhirnya 1 sampai 5 foto; foto pertama menjadi foto utama.
 */
export type PhotoChange = { keep: string[]; add: ProductPhotoFiles[] };
export type UpdateProductResult = "updated" | "conflict" | "not_found" | "invalid_photos";

/** File yang tertinggal hanya memakan ruang, sedangkan data produk sudah benar, jadi kegagalan di sini tidak menggagalkan proses. */
async function discardPhotos(client: SupabaseClient, paths: readonly string[]): Promise<void> {
  for (const path of paths) {
    try {
      await removeProductPhoto(client, path);
    } catch (error) {
      const code = error instanceof ProductRepositoryError ? error.code : undefined;
      console.error("[products] hapus foto gagal", { code });
    }
  }
}

/** Mengunggah berurutan; bila satu gagal, foto yang sudah terunggah di permintaan ini dihapus lagi. */
async function uploadPhotos(client: SupabaseClient, businessId: string, photos: readonly ProductPhotoFiles[]): Promise<string[]> {
  const uploaded: string[] = [];
  try {
    for (const photo of photos) uploaded.push(await uploadProductPhoto(client, businessId, photo));
    return uploaded;
  } catch (error) {
    await discardPhotos(client, uploaded);
    throw error;
  }
}

export async function createProductWithPhotos(
  client: SupabaseClient,
  businessId: string,
  input: ProductInput,
  photos: readonly ProductPhotoFiles[],
): Promise<void> {
  if (photos.length < 1 || photos.length > MAX_PRODUCT_PHOTOS) throw new ProductRepositoryError("createProduct: jumlah foto", undefined);
  const photoPaths = await uploadPhotos(client, businessId, photos);
  try {
    await insertWithGeneratedSku(client, businessId, input, photoPaths);
  } catch (error) {
    await discardPhotos(client, photoPaths);
    throw error;
  }
}

async function insertWithGeneratedSku(
  client: SupabaseClient,
  businessId: string,
  input: ProductInput,
  photoPaths: readonly string[],
): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await insertProduct(client, businessId, input, createProductSku(input.name), photoPaths);
      return;
    } catch (error) {
      const isRetryable = error instanceof ProductRepositoryError && error.isDuplicateSku;
      if (!isRetryable || attempt >= MAX_SKU_ATTEMPTS) throw error;
    }
  }
}

/**
 * Foto baru diunggah sebelum baris diubah; foto lama baru dihapus setelah baris tidak lagi menunjuknya.
 * `keep` hanya boleh berisi foto milik produk ini, agar path produk atau usaha lain tidak bisa diselipkan lewat form.
 */
export async function updateProductWithPhotos(
  client: SupabaseClient,
  businessId: string,
  productId: string,
  expectedVersion: number,
  input: ProductInput,
  photoChange: PhotoChange,
): Promise<UpdateProductResult> {
  const current = await findProduct(client, businessId, productId);
  if (!current) return "not_found";
  if (current.version !== expectedVersion) return "conflict";

  const currentPaths = current.photos.map((photo) => photo.path);
  const keep = [...new Set(photoChange.keep)];
  const total = keep.length + photoChange.add.length;
  if (keep.some((path) => !currentPaths.includes(path)) || total < 1 || total > MAX_PRODUCT_PHOTOS) return "invalid_photos";

  const uploaded = await uploadPhotos(client, businessId, photoChange.add);
  const nextPaths = [...keep, ...uploaded];

  let updated: boolean;
  try {
    updated = await updateProduct(client, businessId, productId, expectedVersion, input, nextPaths);
  } catch (error) {
    await discardPhotos(client, uploaded);
    throw error;
  }

  if (!updated) {
    await discardPhotos(client, uploaded);
    return "conflict";
  }
  await discardPhotos(client, currentPaths.filter((path) => !nextPaths.includes(path)));
  return "updated";
}
