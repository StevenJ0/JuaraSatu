import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { randomSlugSuffix, slugify } from "@/features/business/slug";
import type { PreorderInput } from "@/features/preorders/schemas";
import {
  PreorderRepositoryError,
  savePreorderDraft,
  closePreorderRecord,
  transitionPreorder,
  type PreorderTransition,
  type PreorderViolation,
} from "@/features/preorders/repository";

const SLUG_MAX_LENGTH = 160;
const MAX_SLUG_ATTEMPTS = 3;
const FALLBACK_SLUG = "preorder";

export type PreorderSaveResult = { kind: "saved"; preorderId: string } | { kind: "rejected"; violation: PreorderViolation };
export type PreorderTransitionResult = { kind: "done" } | { kind: "rejected"; violation: PreorderViolation };

/** Slug unik global dan tampil di tautan pembeli; akhiran acak mencegah tabrakan antar-UMKM dan membuatnya sulit ditebak. */
export function createPreorderSlug(name: string, suffix: string = randomSlugSuffix()): string {
  return `${slugify(name, SLUG_MAX_LENGTH - suffix.length - 1, FALLBACK_SLUG)}-${suffix}`;
}

function violationOf(error: unknown): PreorderViolation | null {
  return error instanceof PreorderRepositoryError ? error.violation : null;
}

export async function createPreorderDraft(client: SupabaseClient, input: PreorderInput): Promise<PreorderSaveResult> {
  for (let attempt = 1; ; attempt++) {
    try {
      const preorderId = await savePreorderDraft(client, input, { kind: "new", slug: createPreorderSlug(input.name) });
      return { kind: "saved", preorderId };
    } catch (error) {
      const violation = violationOf(error);
      if (violation) return { kind: "rejected", violation };
      const canRetry = error instanceof PreorderRepositoryError && error.isDuplicateSlug && attempt < MAX_SLUG_ATTEMPTS;
      if (!canRetry) throw error;
    }
  }
}

export async function updatePreorderDraft(
  client: SupabaseClient,
  preorderId: string,
  expectedVersion: number,
  input: PreorderInput,
): Promise<PreorderSaveResult> {
  try {
    const savedId = await savePreorderDraft(client, input, { kind: "existing", preorderId, expectedVersion });
    return { kind: "saved", preorderId: savedId };
  } catch (error) {
    const violation = violationOf(error);
    if (violation) return { kind: "rejected", violation };
    throw error;
  }
}

export async function closePreorder(client: SupabaseClient, preorderId: string, expectedVersion: number, reason: string): Promise<PreorderTransitionResult> {
  try {
    await closePreorderRecord(client, preorderId, expectedVersion, reason);
    return { kind: "done" };
  } catch (error) {
    const violation = violationOf(error);
    if (violation) return { kind: "rejected", violation };
    throw error;
  }
}

export async function runPreorderTransition(
  client: SupabaseClient,
  transition: PreorderTransition,
  preorderId: string,
  expectedVersion: number,
): Promise<PreorderTransitionResult> {
  try {
    await transitionPreorder(client, transition, preorderId, expectedVersion);
    return { kind: "done" };
  } catch (error) {
    const violation = violationOf(error);
    if (violation) return { kind: "rejected", violation };
    throw error;
  }
}
