"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { readTextFields, type FormState } from "@/lib/form-state";
import { requireBusinessOwner } from "@/features/business/guard";
import { PHOTO_UNREADABLE_MESSAGE, readPhotoUpload, requirePhoto, type PhotoReadResult } from "@/features/products/photo";
import { optimizeProductPhoto } from "@/features/products/photo-processing";
import { PRODUCT_FIELDS, productRefSchema, productSchema } from "@/features/products/schemas";
import { ProductRepositoryError, setProductActive } from "@/features/products/repository";
import { createProductWithPhoto, updateProductWithPhoto, type PhotoChange } from "@/features/products/service";

const PRODUCTS_PATH = "/dashboard/products";
const SAVE_FAILED_MESSAGE = "Produk gagal disimpan. Coba lagi beberapa saat lagi.";
const CONFLICT_MESSAGE = "Produk baru saja berubah di tempat lain. Muat ulang halaman, lalu ulangi perubahan.";
const UNREADABLE_PHOTO: PhotoReadResult = { kind: "invalid", message: PHOTO_UNREADABLE_MESSAGE };

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
  photo: PhotoReadResult,
  values: Record<string, string>,
): FormState {
  return {
    status: "error",
    fieldErrors: {
      ...(parsed.success ? {} : z.flattenError(parsed.error).fieldErrors),
      ...(photo.kind === "invalid" ? { photo: [photo.message] } : {}),
    },
    values,
  };
}

export async function createProductAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const { businessId } = await requireBusinessOwner();
  const fields = readTextFields(formData, PRODUCT_FIELDS);
  const parsed = productSchema.safeParse(fields);
  const photo = requirePhoto(await readPhotoUpload(formData.get("photo")));
  if (!parsed.success || photo.kind !== "ok") return invalidFormState(parsed, photo, fields);

  const photoFiles = await optimizeProductPhoto(photo.photo.bytes);
  if (!photoFiles) return invalidFormState(parsed, UNREADABLE_PHOTO, fields);

  try {
    const supabase = await createSupabaseServerClient();
    await createProductWithPhoto(supabase, businessId, parsed.data, photoFiles);
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
  const photo = await readPhotoUpload(formData.get("photo"));
  if (!parsed.success || photo.kind === "invalid") return invalidFormState(parsed, photo, fields);

  const photoFiles = photo.kind === "ok" ? await optimizeProductPhoto(photo.photo.bytes) : null;
  if (photo.kind === "ok" && !photoFiles) return invalidFormState(parsed, UNREADABLE_PHOTO, fields);
  const photoChange: PhotoChange = photoFiles ? { kind: "replace", photo: photoFiles } : { kind: "keep" };

  try {
    const supabase = await createSupabaseServerClient();
    const result = await updateProductWithPhoto(
      supabase,
      businessId,
      ref.data.productId,
      ref.data.version,
      parsed.data,
      photoChange,
    );
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
