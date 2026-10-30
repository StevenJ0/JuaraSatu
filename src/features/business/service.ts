import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { BusinessProfileInput } from "@/features/business/schemas";
import { createBusinessSlug } from "@/features/business/slug";
import {
  BusinessRepositoryError,
  createBusinessWithOwner,
  findOwnedBusinessId,
} from "@/features/business/repository";

const MAX_SLUG_ATTEMPTS = 3;

export type CreateBusinessResult = { kind: "created"; businessId: string } | { kind: "already_owned"; businessId: string };

/**
 * Onboarding: satu owner hanya boleh punya satu business (schema §4.2). Tabrakan slug dicoba ulang
 * dengan akhiran baru; bila tabrakan berasal dari owner yang sudah punya business (submit ganda),
 * business yang sudah ada dikembalikan.
 */
export async function createBusinessForOwner(
  client: SupabaseClient,
  userId: string,
  input: BusinessProfileInput,
): Promise<CreateBusinessResult> {
  const existingId = await findOwnedBusinessId(client, userId);
  if (existingId) return { kind: "already_owned", businessId: existingId };

  for (let attempt = 1; ; attempt++) {
    try {
      const businessId = await createBusinessWithOwner(client, { ...input, slug: createBusinessSlug(input.name) });
      return { kind: "created", businessId };
    } catch (error) {
      if (!(error instanceof BusinessRepositoryError) || !error.isUniqueViolation) throw error;

      const ownedAfterConflict = await findOwnedBusinessId(client, userId);
      if (ownedAfterConflict) return { kind: "already_owned", businessId: ownedAfterConflict };
      if (attempt >= MAX_SLUG_ATTEMPTS) throw error;
    }
  }
}
