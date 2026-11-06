import "server-only";
import { z } from "zod";
import { SupabaseError } from "@/lib/supabase/transport.server";
import type { ExecutionRepository } from "./repository.server";
import { projectPublishedOffer } from "./projections";
import { PublishedOfferSchema, type PublishedOffer } from "./contracts";

/** C3 producer only. C8 must combine this with authoritative preorder availability at checkout. */
export async function readPublishedOffer(repository: ExecutionRepository, scope: { businessId: string; preorderId: string }, now: string): Promise<PublishedOffer> {
  try { return projectPublishedOffer(scope, await repository.offer(scope.preorderId), now); }
  catch (error) {
    if (error instanceof z.ZodError) return projectPublishedOffer(scope, {}, now);
    if (error instanceof SupabaseError && error.status >= 500) return PublishedOfferSchema.parse({ schemaVersion: 1, ...scope, calculatedAt: now,
      state: "unavailable", eligible: false, reason: "SOURCE_UNAVAILABLE", configuration: null });
    throw error;
  }
}
