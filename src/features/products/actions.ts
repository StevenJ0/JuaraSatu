"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { readTextFields, type FormState } from "@/lib/form-state";
import { requireBusinessOwner } from "@/features/business/guard";
import {
  MAX_PRODUCT_PHOTOS,
  PHOTO_LIMIT_MESSAGE,
  PHOTO_REQUIRED_MESSAGE,
  PHOTO_UNREADABLE_MESSAGE,
  moveToFront,
  readPhotoUploads,
  readPrimaryPhoto,
  type PhotoUpload,
} from "@/features/products/photo";
import { optimizeProductPhoto, type ProductPhotoFiles } from "@/features/products/photo-processing";
import { PRODUCT_FIELDS, productRefSchema, productSchema } from "@/features/products/schemas";
import { ProductRepositoryError, setProductActive } from "@/features/products/repository";
import { createProductWithPhotos, updateProductWithPhotos } from "@/features/products/service";

const PRODUCTS_PATH = "/dashboard/products";
const SAVE_FAILED_MESSAGE = "Produk gagal disimpan. Coba lagi beberapa saat lagi.";
const CONFLICT_MESSAGE = "Produk baru saja berubah di tempat lain. Muat ulang halaman, lalu ulangi perubahan.";
const PHOTO_CHANGED_MESSAGE = "Foto produk baru saja berubah. Muat ulang halaman, lalu ulangi perubahan.";

function logRepositoryFailure(context: string, error: unknown): void {
  // Hanya kode error yang dicatat; jangan log input produk atau identitas user.
  const code = error instanceof ProductRepositoryError ? error.code : undefined;
  console.error(`[products] ${context} gagal`, { code });
}

function refreshProductPages(): void {
  // Layout dashboard ikut diperbarui karena checklist Ringkasan bergantung pada jumlah produk aktif.
  revalidatePath("/dashboard", "layout");
}

function invalidFormState(
  parsed: ReturnType<typeof productSchema.safeParse>,
  photoError: string | null,
  values: Record<string, string>,
): FormState {
  return {
    status: "error",
    fieldErrors: {
      ...(parsed.success ? {} : z.flattenError(parsed.error).fieldErrors),
      ...(photoError ? { photo: [photoError] } : {}),
    },
    values,
  };
}

/** Null bila ada satu foto yang tidak bisa diolah; semua foto harus lolos agar urutan yang dipilih pemilik tetap utuh. */
async function optimizePhotos(photos: readonly PhotoUpload[]): Promise<ProductPhotoFiles[] | null> {
  const optimized: ProductPhotoFiles[] = [];
  for (const photo of photos) {
    const files = await optimizeProductPhoto(photo.bytes);
    if (!files) return null;
    optimized.push(files);
  }
  return optimized;
}

export async function createProductAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const { businessId } = await requireBusinessOwner();
  const fields = readTextFields(formData, PRODUCT_FIELDS);
  const parsed = productSchema.safeParse(fields);
  const photos = await readPhotoUploads(formData.getAll("photo"));
  const photoError = photos.kind === "invalid" ? photos.message : photos.photos.length === 0 ? PHOTO_REQUIRED_MESSAGE : null;
  if (!parsed.success || photos.kind !== "ok" || photoError) return invalidFormState(parsed, photoError, fields);

  // Produk baru belum punya foto lama, jadi pilihan foto utama hanya bisa menunjuk foto yang baru dikirim.
  const primary = readPrimaryPhoto(formData.get("primaryPhoto"));
  const ordered = moveToFront(photos.photos, primary?.kind === "new" ? primary.index : 0);
  if (!ordered) return invalidFormState(parsed, PHOTO_CHANGED_MESSAGE, fields);

  const photoFiles = await optimizePhotos(ordered);
  if (!photoFiles) return invalidFormState(parsed, PHOTO_UNREADABLE_MESSAGE, fields);

  try {
    const supabase = await createSupabaseServerClient();
    await createProductWithPhotos(supabase, businessId, parsed.data, photoFiles);
  } catch (error) {
    logRepositoryFailure("createProduct", error);
    return { status: "error", message: SAVE_FAILED_MESSAGE, values: fields };
  }

  refreshProductPages();
  redirect(`${PRODUCTS_PATH}?saved=created`);
}

export async function updateProductAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const { businessId } = await requireBusinessOwner();
  const fields = readTextFields(formData, PRODUCT_FIELDS);
  const ref = productRefSchema.safeParse(readTextFields(formData, ["productId", "version"]));
  if (!ref.success) return { status: "error", message: SAVE_FAILED_MESSAGE, values: fields };

  const parsed = productSchema.safeParse(fields);
  // Path foto lama hanya petunjuk dari form; service memastikan semuanya memang milik produk ini.
  const keep = formData.getAll("keepPhoto").filter((value): value is string => typeof value === "string" && value !== "");
  if (keep.length > MAX_PRODUCT_PHOTOS) return invalidFormState(parsed, PHOTO_LIMIT_MESSAGE, fields);
  const photos = await readPhotoUploads(formData.getAll("photo"), MAX_PRODUCT_PHOTOS - keep.length);
  const photoError =
    photos.kind === "invalid" ? photos.message : keep.length + photos.photos.length === 0 ? PHOTO_REQUIRED_MESSAGE : null;
  if (!parsed.success || photos.kind !== "ok" || photoError) return invalidFormState(parsed, photoError, fields);

  const photoFiles = await optimizePhotos(photos.photos);
  if (!photoFiles) return invalidFormState(parsed, PHOTO_UNREADABLE_MESSAGE, fields);

  try {
    const supabase = await createSupabaseServerClient();
    const result = await updateProductWithPhotos(supabase, businessId, ref.data.productId, ref.data.version, parsed.data, {
      keep,
      add: photoFiles,
      primary: readPrimaryPhoto(formData.get("primaryPhoto")),
    });
    if (result === "invalid_photos") return invalidFormState(parsed, PHOTO_CHANGED_MESSAGE, fields);
    if (result === "conflict") return { status: "error", message: CONFLICT_MESSAGE, values: fields };
    if (result === "not_found") return { status: "error", message: SAVE_FAILED_MESSAGE, values: fields };
  } catch (error) {
    logRepositoryFailure("updateProduct", error);
    return { status: "error", message: SAVE_FAILED_MESSAGE, values: fields };
  }

  refreshProductPages();
  redirect(`${PRODUCTS_PATH}?saved=updated`);
}

/** Produk dinonaktifkan, bukan dihapus, agar histori preorder dan order tetap utuh (schema §5.1). */
export async function setProductActiveAction(formData: FormData): Promise<void> {
  const { businessId } = await requireBusinessOwner();
  const ref = productRefSchema.safeParse(readTextFields(formData, ["productId", "version"]));
  if (!ref.success) return;

  try {
    const supabase = await createSupabaseServerClient();
    await setProductActive(supabase, businessId, ref.data.productId, ref.data.version, formData.get("isActive") === "true");
  } catch (error) {
    logRepositoryFailure("setProductActive", error);
    throw new Error("Status produk gagal diubah");
  }

  // Versi kedaluwarsa tidak mengubah apa pun; halaman yang dimuat ulang menampilkan status terbaru.
  refreshProductPages();
}
