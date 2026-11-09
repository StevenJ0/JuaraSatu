import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { findOwnedBusinessId } from "@/features/business/repository";
import { findPreorderContext } from "@/features/preorders/repository";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/service-role";
import { supabaseUtcTimestamp } from "@/lib/supabase/timestamps";
import { BuildBusinessContextInputSchema, type BuildBusinessContextInput, type ContextReadScope } from "./contracts";

export class OwnedContextError extends Error {
  constructor(readonly code: "UNAUTHENTICATED" | "FORBIDDEN" | "NOT_FOUND" | "READ_FAILED" | "INVALID_SOURCE") {
    super(code);
  }
}

const OfferSchema = z.object({ discount_bps: z.number().int().min(0).max(9999), pricing_campaign_id: z.uuid().nullable(),
  final_unit_price_idr: z.number().int().positive() });
const PricingCampaignSchema = z.object({ id: z.uuid(), version: z.number().int().positive(), status: z.literal("published"),
  starts_at: z.string(), ends_at: z.string(), published_at: z.string() });

/** Reads the same SQL offer resolver (C8) that the buyer page and checkout use. */
export type PreorderOfferReader = (preorderId: string) => Promise<unknown>;
// `read_preorder_offer` is granted to service_role only. It is called after ownership of the preorder is proven
// through the owner's RLS session below, and returns prices only.
const serviceRoleOfferReader: PreorderOfferReader = async (preorderId) => {
  const { data, error } = await createSupabaseServiceRoleClient().rpc("read_preorder_offer", { p_preorder_id: preorderId });
  if (error) throw new OwnedContextError("READ_FAILED");
  return data;
};

/** Requires a session client: identity and membership are verified again on every source revalidation. */
export async function loadOwnedPreorderContext(
  client: SupabaseClient,
  scope: ContextReadScope,
  now: () => string = () => new Date().toISOString(),
  readOffer: PreorderOfferReader = serviceRoleOfferReader,
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
  const offer = OfferSchema.safeParse(await readOffer(core.preorder.id));
  if (!offer.success) throw new OwnedContextError("READ_FAILED");
  let campaign: z.infer<typeof PricingCampaignSchema> | null = null;
  if (offer.data.pricing_campaign_id !== null) {
    const rows = await client.from("campaigns").select("id,version,status,starts_at,ends_at,published_at").eq("business_id", businessId)
      .eq("preorder_id", core.preorder.id).eq("id", offer.data.pricing_campaign_id).limit(1);
    if (rows.error) throw new OwnedContextError("READ_FAILED");
    const parsed = z.array(PricingCampaignSchema).length(1).safeParse(rows.data);
    if (!parsed.success) throw new OwnedContextError("INVALID_SOURCE");
    campaign = parsed.data[0];
  }
  const snapshot = { provenance: "server", calculatedAt: core.asOf, preorderVersion: core.preorder.version,
    preorderItemVersion: core.preorder.itemVersion, productVersion: core.product.version, capacityVersion: core.capacity.version };
  const effectiveOffer = campaign === null
    ? { state: "none", offer: { offerType: "normal_price", discountBps: 0 }, unitPriceIdr: offer.data.final_unit_price_idr, campaign: null }
    : { state: "active", offer: offer.data.discount_bps > 0 ? { offerType: "percent_discount", discountBps: offer.data.discount_bps }
      : { offerType: "normal_price", discountBps: 0 }, unitPriceIdr: offer.data.final_unit_price_idr,
    campaign: { businessId, preorderId: core.preorder.id, campaignId: campaign.id, version: campaign.version, status: campaign.status,
      startsAt: supabaseUtcTimestamp(campaign.starts_at), endsAt: supabaseUtcTimestamp(campaign.ends_at),
      publishedAt: supabaseUtcTimestamp(campaign.published_at) } };
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
    c8: { status: "available", data: {
      businessId, preorderId: core.preorder.id, productId: core.product.id, preorderItemId: core.preorder.itemId,
      baseUnitPriceIdr: core.product.basePriceIdr, effectiveOffer,
      snapshot: { provenance: "server", calculatedAt: core.asOf, preorderVersion: core.preorder.version,
        preorderItemVersion: core.preorder.itemVersion,
        offerVersion: campaign === null ? "no-active-campaign" : `campaign:${campaign.id}:v${campaign.version}` },
    } },
    hypotheticalScenario: null, history: { status: "not_requested" },
  });
}
