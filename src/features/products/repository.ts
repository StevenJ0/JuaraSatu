import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { fullPhotoPath, thumbnailPathOf } from "@/features/products/photo";
import type { ProductPhotoFiles } from "@/features/products/photo-processing";
import { COST_QUALITIES, type CostQuality, type ProductInput } from "@/features/products/schemas";

const UNIQUE_VIOLATION = "23505";
const PHOTO_BUCKET = "product-photos";
const PHOTO_CACHE_SECONDS = "31536000";

export class ProductRepositoryError extends Error {
  constructor(
    operation: string,
    readonly code: string | undefined,
  ) {
    super(`Product repository gagal: ${operation}${code ? ` (${code})` : ""}`);
    this.name = "ProductRepositoryError";
  }

  /** Satu-satunya unique yang bisa dilanggar saat insert produk adalah (business_id, sku). */
  get isDuplicateSku(): boolean {
    return this.code === UNIQUE_VIOLATION;
  }
}

function fail(operation: string, error: PostgrestError): never {
  throw new ProductRepositoryError(operation, error.code);
}

const productRowSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  description: z.string().nullable(),
  photo_path: z.string().nullable(),
  base_price_idr: z.number(),
  variable_cost_idr: z.number().nullable(),
  cost_quality: z.enum(COST_QUALITIES),
  is_active: z.boolean(),
  version: z.number(),
});

const PRODUCT_COLUMNS =
  "id, name, description, photo_path, base_price_idr, variable_cost_idr, cost_quality, is_active, version";

export type Product = {
  id: string;
  name: string;
  description: string | null;
  photoPath: string | null;
  photoUrl: string | null;
  /** Versi kecil untuk daftar; foto lama yang belum punya versi kecil memakai foto utamanya. */
  thumbnailUrl: string | null;
  basePriceIdr: number;
  variableCostIdr: number | null;
  costQuality: CostQuality;
  isActive: boolean;
  version: number;
};

export function productPhotoUrls(client: SupabaseClient, photoPath: string | null): { photoUrl: string | null; thumbnailUrl: string | null } {
  if (!photoPath) return { photoUrl: null, thumbnailUrl: null };
  const publicUrl = (path: string) => client.storage.from(PHOTO_BUCKET).getPublicUrl(path).data.publicUrl;
  return { photoUrl: publicUrl(photoPath), thumbnailUrl: publicUrl(thumbnailPathOf(photoPath) ?? photoPath) };
}

function toProduct(client: SupabaseClient, row: z.infer<typeof productRowSchema>): Product {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    photoPath: row.photo_path,
    ...productPhotoUrls(client, row.photo_path),
    basePriceIdr: row.base_price_idr,
    variableCostIdr: row.variable_cost_idr,
    costQuality: row.cost_quality,
    isActive: row.is_active,
    version: row.version,
  };
}

function toProductColumns(input: ProductInput, photoPath: string | null) {
  return {
    name: input.name,
    description: input.description,
    photo_path: photoPath,
    base_price_idr: input.basePriceIdr,
    variable_cost_idr: input.variableCostIdr,
    cost_quality: input.costQuality,
  };
}

export async function listProducts(client: SupabaseClient, businessId: string): Promise<Product[]> {
  const { data, error } = await client
    .from("products")
    .select(PRODUCT_COLUMNS)
    .eq("business_id", businessId)
    .order("is_active", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) fail("listProducts", error);
  return z
    .array(productRowSchema)
    .parse(data)
    .map((row) => toProduct(client, row));
}

export async function findProduct(
  client: SupabaseClient,
  businessId: string,
  productId: string,
): Promise<Product | null> {
  const { data, error } = await client
    .from("products")
    .select(PRODUCT_COLUMNS)
    .eq("business_id", businessId)
    .eq("id", productId)
    .maybeSingle();
  if (error) fail("findProduct", error);
  return data === null ? null : toProduct(client, productRowSchema.parse(data));
}

export async function countActiveProducts(client: SupabaseClient, businessId: string): Promise<number> {
  const { count, error } = await client
    .from("products")
    .select("id", { count: "exact", head: true })
    .eq("business_id", businessId)
    .eq("is_active", true);
  if (error) fail("countActiveProducts", error);
  return count ?? 0;
}

export async function insertProduct(
  client: SupabaseClient,
  businessId: string,
  input: ProductInput,
  sku: string,
  photoPath: string | null,
): Promise<void> {
  const { error } = await client.from("products").insert({ business_id: businessId, sku, ...toProductColumns(input, photoPath) });
  if (error) fail("insertProduct", error);
}

/** Mengembalikan false bila baris sudah berubah sejak `expectedVersion`; `version` dinaikkan trigger database. */
export async function updateProduct(
  client: SupabaseClient,
  businessId: string,
  productId: string,
  expectedVersion: number,
  input: ProductInput,
  photoPath: string | null,
): Promise<boolean> {
  return applyVersionedUpdate(client, "updateProduct", businessId, productId, expectedVersion, toProductColumns(input, photoPath));
}

export async function setProductActive(
  client: SupabaseClient,
  businessId: string,
  productId: string,
  expectedVersion: number,
  isActive: boolean,
): Promise<boolean> {
  return applyVersionedUpdate(client, "setProductActive", businessId, productId, expectedVersion, { is_active: isActive });
}

async function applyVersionedUpdate(
  client: SupabaseClient,
  operation: string,
  businessId: string,
  productId: string,
  expectedVersion: number,
  columns: Record<string, string | number | boolean | null>,
): Promise<boolean> {
  const { data, error } = await client
    .from("products")
    .update(columns)
    .eq("business_id", businessId)
    .eq("id", productId)
    .eq("version", expectedVersion)
    .select("id");
  if (error) fail(operation, error);
  return z.array(z.object({ id: z.uuid() })).parse(data).length === 1;
}

/** Nama file selalu baru agar URL publik lama yang tersimpan di cache tidak menampilkan foto yang salah. */
export async function uploadProductPhoto(
  client: SupabaseClient,
  businessId: string,
  files: ProductPhotoFiles,
): Promise<string> {
  const path = fullPhotoPath(`${businessId}/${randomUUID()}`);
  const thumbnailPath = thumbnailPathOf(path);
  if (!thumbnailPath) throw new ProductRepositoryError("uploadProductPhoto: path versi kecil", undefined);

  const bucket = client.storage.from(PHOTO_BUCKET);
  const options = { contentType: "image/webp", cacheControl: PHOTO_CACHE_SECONDS, upsert: false };
  const { error } = await bucket.upload(path, files.full, options);
  if (error) throw new ProductRepositoryError("uploadProductPhoto", error.name);

  const { error: thumbnailError } = await bucket.upload(thumbnailPath, files.thumbnail, options);
  if (thumbnailError) {
    await removeProductPhoto(client, path);
    throw new ProductRepositoryError("uploadProductPhoto: versi kecil", thumbnailError.name);
  }
  return path;
}

/** Menghapus foto beserta versi kecilnya; menghapus file yang tidak ada bukan error di Storage. */
export async function removeProductPhoto(client: SupabaseClient, path: string): Promise<void> {
  const thumbnailPath = thumbnailPathOf(path);
  const { error } = await client.storage.from(PHOTO_BUCKET).remove(thumbnailPath ? [path, thumbnailPath] : [path]);
  if (error) throw new ProductRepositoryError("removeProductPhoto", error.name);
}
