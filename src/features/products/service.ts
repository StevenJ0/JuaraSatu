import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PhotoUpload } from "@/features/products/photo";
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

export type PhotoChange = { kind: "keep" } | { kind: "replace"; photo: PhotoUpload };
export type UpdateProductResult = "updated" | "conflict" | "not_found";

/** File yang tertinggal hanya memakan ruang, sedangkan data produk sudah benar, jadi kegagalan di sini tidak menggagalkan proses. */
async function discardPhoto(client: SupabaseClient, path: string | null): Promise<void> {
  if (!path) return;
  try {
    await removeProductPhoto(client, path);
  } catch (error) {
    const code = error instanceof ProductRepositoryError ? error.code : undefined;
    console.error("[products] hapus foto gagal", { code });
  }
}

export async function createProductWithPhoto(
  client: SupabaseClient,
  businessId: string,
  input: ProductInput,
  photo: PhotoUpload,
): Promise<void> {
  const photoPath = await uploadProductPhoto(client, businessId, photo);
  try {
    await insertWithGeneratedSku(client, businessId, input, photoPath);
  } catch (error) {
    await discardPhoto(client, photoPath);
    throw error;
  }
}

async function insertWithGeneratedSku(
  client: SupabaseClient,
  businessId: string,
  input: ProductInput,
  photoPath: string,
): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await insertProduct(client, businessId, input, createProductSku(input.name), photoPath);
      return;
    } catch (error) {
      const isRetryable = error instanceof ProductRepositoryError && error.isDuplicateSku;
      if (!isRetryable || attempt >= MAX_SKU_ATTEMPTS) throw error;
    }
  }
}

/** Foto baru diunggah sebelum baris diubah; foto lama baru dihapus setelah baris tidak lagi menunjuknya. */
export async function updateProductWithPhoto(
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

  const uploadedPath = photoChange.kind === "replace" ? await uploadProductPhoto(client, businessId, photoChange.photo) : null;
  const nextPath = uploadedPath ?? current.photoPath;

  let updated: boolean;
  try {
    updated = await updateProduct(client, businessId, productId, expectedVersion, input, nextPath);
  } catch (error) {
    await discardPhoto(client, uploadedPath);
    throw error;
  }

  if (!updated) {
    await discardPhoto(client, uploadedPath);
    return "conflict";
  }
  if (nextPath !== current.photoPath) await discardPhoto(client, current.photoPath);
  return "updated";
}
