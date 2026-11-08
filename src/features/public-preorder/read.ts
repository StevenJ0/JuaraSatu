import "server-only";
import { z } from "zod";
import type { PublicPreorder } from "@/features/preorders/context";
import { findPublicPreorder } from "@/features/preorders/repository";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/service-role";

export const publicPreorderSlugSchema = z.string().min(3).max(160).regex(/^[a-z0-9-]+$/);

/**
 * Kontrak C1 milik core, sehingga harga tampil sama dengan harga yang dipakai `create_preorder_order`, termasuk diskon kampanye aktif.
 * Slug dicek sebelum membuat client, agar slug asal-asalan tidak menyentuh database.
 */
export async function loadPublicPreorder(slug: unknown): Promise<PublicPreorder | null> {
  const parsed = publicPreorderSlugSchema.safeParse(slug);
  if (!parsed.success) return null;
  return findPublicPreorder(createSupabaseServiceRoleClient(), parsed.data);
}
