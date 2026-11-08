import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { findOwnedBusinessId } from "@/features/business/repository";
import { findPreorderContext } from "@/features/preorders/repository";
import { supabaseUtcTimestamp } from "@/lib/supabase/timestamps";
import { BuildBusinessContextInputSchema, type BuildBusinessContextInput, type ContextReadScope } from "./contracts";

export class OwnedContextError extends Error {
  constructor(readonly code: "UNAUTHENTICATED" | "FORBIDDEN" | "NOT_FOUND" | "READ_FAILED" | "INVALID_SOURCE") {
    super(code);
  }
}

/** Requires a session client: identity and membership are verified again on every source revalidation. */
export async function loadOwnedPreorderContext(
  client: SupabaseClient,
  scope: ContextReadScope,
  now: () => string = () => new Date().toISOString(),
): Promise<BuildBusinessContextInput> {
  const identity = await client.auth.getUser();
  if (identity.error || !identity.data.user) throw new OwnedContextError("UNAUTHENTICATED");
  const businessId = await findOwnedBusinessId(client, identity.data.user.id);
  if (!businessId || businessId !== scope.businessId) throw new OwnedContextError("FORBIDDEN");
  const asOf = now();
  const core = await findPreorderContext(client, businessId, scope.preorderId, new Date(asOf));
  if (!core) throw new OwnedContextError("NOT_FOUND");
  if (core.business.id !== businessId || core.preorder.status !== "published" || !core.product.isActive) {
    throw new OwnedContextError("INVALID_SOURCE");
  }
  const campaigns = await client.from("campaigns").select("id").eq("business_id", businessId)
    .eq("preorder_id", core.preorder.id).eq("status", "published").limit(1);
  if (campaigns.error) throw new OwnedContextError("READ_FAILED");
  const published = z.array(z.object({ id: z.uuid() })).parse(campaigns.data);
  const snapshot = { provenance: "server", calculatedAt: core.asOf, preorderVersion: core.preorder.version,
    preorderItemVersion: core.preorder.itemVersion, productVersion: core.product.version, capacityVersion: core.capacity.version };
  return BuildBusinessContextInputSchema.parse({
    scope: { businessId, preorderId: core.preorder.id }, calculatedAt: now(), maxSourceAgeSeconds: 60,
    analyticsRequirement: "optional",
    c1: { status: "available", data: {
      business: { businessId, name: core.business.name, category: core.business.categories[0], categories: core.business.categories,
        description: core.business.description, locationContext: null },
      product: { businessId, productId: core.product.id, name: core.product.name, category: null,
        description: core.product.description, catalogUnitPriceIdr: core.product.catalogPriceIdr,
        variableCostIdr: core.product.variableCostIdr, costQuality: core.product.costQuality },
      preorder: { businessId, productId: core.product.id, preorderId: core.preorder.id, preorderItemId: core.preorder.itemId,
        preorderName: core.preorder.name, baseUnitPriceIdr: core.product.basePriceIdr, targetUnits: core.preorder.targetUnits,
        quotaUnits: core.preorder.quotaUnits, paidUnits: core.units.paid, heldUnits: core.units.held,
        allocatedUnits: core.units.allocated, orderableUnits: core.units.orderable, preorderStatus: core.preorder.status,
        startsAt: supabaseUtcTimestamp(core.preorder.startsAt), endsAt: supabaseUtcTimestamp(core.preorder.endsAt),
        intakeCutoffAt: supabaseUtcTimestamp(core.preorder.intakeCutoffAt),
        fulfillmentDate: core.preorder.fulfillmentDate },
      capacity: { capacityId: core.capacity.id, version: core.capacity.version, totalUnits: core.capacity.totalUnits,
        allocatedUnits: core.capacity.availability.allocated, heldUnits: core.capacity.availability.effectiveHeld,
        availableUnits: core.capacity.availability.available }, snapshot,
    } },
    c6: { status: "unavailable", reason: "not_implemented" },
    // shortcut: until C8 is connected in P2-1, published campaigns are unavailable; only proven absence permits a normal offer.
    c8: published.length ? { status: "unavailable", reason: "not_implemented" } : { status: "available", data: {
      businessId, preorderId: core.preorder.id, productId: core.product.id, preorderItemId: core.preorder.itemId,
      baseUnitPriceIdr: core.product.basePriceIdr,
      effectiveOffer: { state: "none", offer: { offerType: "normal_price", discountBps: 0 }, unitPriceIdr: core.product.basePriceIdr, campaign: null },
      snapshot: { provenance: "server", calculatedAt: core.asOf, preorderVersion: core.preorder.version,
        preorderItemVersion: core.preorder.itemVersion, offerVersion: "no-published-campaign" },
    } },
    hypotheticalScenario: null, history: { status: "not_requested" },
  });
}
