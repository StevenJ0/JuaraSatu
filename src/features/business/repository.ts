import "server-only";
import { z } from "zod";
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import type { BusinessProfileInput } from "@/features/business/schemas";

const UNIQUE_VIOLATION = "23505";

export class BusinessRepositoryError extends Error {
  constructor(
    operation: string,
    readonly code: string | undefined,
  ) {
    super(`Business repository gagal: ${operation}${code ? ` (${code})` : ""}`);
    this.name = "BusinessRepositoryError";
  }

  get isUniqueViolation(): boolean {
    return this.code === UNIQUE_VIOLATION;
  }
}

function fail(operation: string, error: PostgrestError): never {
  throw new BusinessRepositoryError(operation, error.code);
}

const membershipRowSchema = z.object({ business_id: z.uuid() });

const businessRowSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  slug: z.string(),
  category: z.string(),
  description: z.string().nullable(),
  public_contact: z.string().nullable(),
  pickup_instructions: z.string().nullable(),
  timezone: z.string(),
});

const BUSINESS_COLUMNS = "id, name, slug, category, description, public_contact, pickup_instructions, timezone";

export type BusinessProfile = {
  id: string;
  name: string;
  slug: string;
  category: string;
  description: string | null;
  publicContact: string | null;
  pickupInstructions: string | null;
  timezone: string;
};

function toBusinessProfile(row: z.infer<typeof businessRowSchema>): BusinessProfile {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    category: row.category,
    description: row.description,
    publicContact: row.public_contact,
    pickupInstructions: row.pickup_instructions,
    timezone: row.timezone,
  };
}

/** Business milik user sebagai owner, atau null bila belum punya (schema §4.2: satu business per owner di MVP). */
export async function findOwnedBusinessId(client: SupabaseClient, userId: string): Promise<string | null> {
  const { data, error } = await client
    .from("business_members")
    .select("business_id")
    .eq("user_id", userId)
    .eq("role", "owner")
    .maybeSingle();
  if (error) fail("findOwnedBusinessId", error);
  if (data === null) return null;
  return membershipRowSchema.parse(data).business_id;
}

export async function getBusinessProfile(client: SupabaseClient, businessId: string): Promise<BusinessProfile> {
  const { data, error } = await client.from("businesses").select(BUSINESS_COLUMNS).eq("id", businessId).single();
  if (error) fail("getBusinessProfile", error);
  return toBusinessProfile(businessRowSchema.parse(data));
}

/**
 * Membuat business + membership owner dalam satu transaksi melalui RPC `create_business_with_owner`.
 * Kontrak RPC (belum ada di schema §8.1, menunggu migration tim): SECURITY DEFINER, owner = auth.uid(),
 * role selalu 'owner', mengembalikan uuid business baru.
 */
export async function createBusinessWithOwner(
  client: SupabaseClient,
  input: BusinessProfileInput & { slug: string },
): Promise<string> {
  const { data, error } = await client.rpc("create_business_with_owner", {
    p_name: input.name,
    p_slug: input.slug,
    p_category: input.category,
    p_description: input.description,
    p_public_contact: input.publicContact,
    p_pickup_instructions: input.pickupInstructions,
  });
  if (error) fail("createBusinessWithOwner", error);
  return z.uuid().parse(data);
}

export async function updateBusinessProfile(
  client: SupabaseClient,
  businessId: string,
  input: BusinessProfileInput,
): Promise<void> {
  const { data, error } = await client
    .from("businesses")
    .update({
      name: input.name,
      category: input.category,
      description: input.description,
      public_contact: input.publicContact,
      pickup_instructions: input.pickupInstructions,
      updated_at: new Date().toISOString(),
    })
    .eq("id", businessId)
    .select("id");
  if (error) fail("updateBusinessProfile", error);
  // RLS menyembunyikan baris milik business lain sehingga update "berhasil" tanpa mengubah apa pun.
  if (z.array(z.object({ id: z.uuid() })).parse(data).length !== 1) {
    throw new BusinessRepositoryError("updateBusinessProfile: business tidak ditemukan", undefined);
  }
}
