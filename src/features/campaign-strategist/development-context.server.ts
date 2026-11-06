import "server-only";
import { z } from "zod";
import { BuildBusinessContextInputSchema, type BuildBusinessContextInput } from "../ai-context";
import type { SupabaseTransport } from "@/lib/supabase/transport.server";
import { developmentEnabled } from "./development-provider";
import { supabaseUtcTimestamp } from "@/lib/supabase/timestamps";
import { configuredEmbedding, retrieveMemoryHistory, type MemoryRetrievalEnvironment } from "../business-memory/retrieval.server";

const PreorderSchema = z.object({ id: z.uuid(), business_id: z.uuid(), name: z.string(), status: z.literal("published"),
  starts_at: z.iso.datetime({ offset: true }), ends_at: z.iso.datetime({ offset: true }), fulfillment_date: z.string(), version: z.number().int().positive() });
const ItemSchema = z.object({ id: z.uuid(), product_id: z.uuid(), capacity_id: z.uuid(), target_units: z.literal(40), quota_units: z.literal(40),
  base_price_snapshot_idr: z.number().int().positive().max(1_000_000_000), version: z.number().int().positive() });
const ProductSchema = z.object({ id: z.uuid(), name: z.string(), base_price_idr: z.number().int().positive().max(1_000_000_000),
  variable_cost_idr: z.number().int().nonnegative().max(1_000_000_000).nullable(), cost_quality: z.enum(["unknown", "estimated", "verified"]), version: z.number().int().positive() });
const CapacitySchema = z.object({ id: z.uuid(), total_units: z.literal(40), intake_cutoff_at: z.iso.datetime({ offset: true }), version: z.number().int().positive() });
const BusinessSchema = z.object({ id: z.uuid(), name: z.string(), category: z.string(), is_demo: z.literal(true) });
function one<T>(schema: z.ZodType<T>, rows: unknown): T { return z.array(schema).length(1).parse(rows)[0]; }
export function seededDevelopmentContext(user: SupabaseTransport, environment: Parameters<typeof developmentEnabled>[0] & MemoryRetrievalEnvironment, now: () => string) {
  return async (scope: { businessId: string; preorderId: string }): Promise<BuildBusinessContextInput> => {
    if (!developmentEnabled(environment) || !["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1"].includes(scope.businessId)) {
      throw new Error("Production context producers unavailable");
    }
    const [rawBusiness, rawPreorder, rawItem, orders, campaigns] = await Promise.all([
      user.select("businesses", { select: "id,name,category,is_demo", id: `eq.${scope.businessId}` }),
      user.select("preorders", { select: "id,business_id,name,status,starts_at,ends_at,fulfillment_date,version", id: `eq.${scope.preorderId}`, business_id: `eq.${scope.businessId}` }),
      user.select("preorder_items", { select: "id,product_id,capacity_id,target_units,quota_units,base_price_snapshot_idr,version", preorder_id: `eq.${scope.preorderId}`, business_id: `eq.${scope.businessId}` }),
      user.select("orders", { select: "id", preorder_id: `eq.${scope.preorderId}`, limit: "1" }),
      user.select("campaigns", { select: "id", preorder_id: `eq.${scope.preorderId}`, status: "eq.published", limit: "1" }),
    ]);
    // This is an empty seeded demonstration, never a replacement for production availability/offer readers.
    z.array(z.unknown()).length(0).parse(orders); z.array(z.unknown()).length(0).parse(campaigns);
    const business = one(BusinessSchema, rawBusiness); const preorder = one(PreorderSchema, rawPreorder); const item = one(ItemSchema, rawItem);
    const [rawProduct, rawCapacity, reservations] = await Promise.all([
      user.select("products", { select: "id,name,base_price_idr,variable_cost_idr,cost_quality,version", id: `eq.${item.product_id}`, business_id: `eq.${scope.businessId}` }),
      user.select("production_capacity", { select: "id,total_units,intake_cutoff_at,version", id: `eq.${item.capacity_id}`, business_id: `eq.${scope.businessId}` }),
      user.select("capacity_reservations", { select: "id", capacity_id: `eq.${item.capacity_id}`, state: "in.(held,allocated)", limit: "1" }),
    ]);
    z.array(z.unknown()).length(0).parse(reservations);
    const product = one(ProductSchema, rawProduct); const capacity = one(CapacitySchema, rawCapacity); const calculatedAt = now();
    const snapshot = { provenance: "development_fixture", calculatedAt, preorderVersion: preorder.version,
      preorderItemVersion: item.version, productVersion: product.version, capacityVersion: capacity.version } as const;
    const input = BuildBusinessContextInputSchema.parse({ scope, calculatedAt, maxSourceAgeSeconds: 60, analyticsRequirement: "optional",
      c1: { status: "available", data: { business: { businessId: business.id, name: business.name, category: business.category, description: null, locationContext: null },
        product: { businessId: business.id, productId: product.id, name: product.name, category: null, description: null,
          catalogUnitPriceIdr: product.base_price_idr, variableCostIdr: product.variable_cost_idr, costQuality: product.cost_quality },
        preorder: { businessId: business.id, productId: product.id, preorderId: preorder.id, preorderItemId: item.id, preorderName: preorder.name,
          baseUnitPriceIdr: item.base_price_snapshot_idr, targetUnits: 40, quotaUnits: 40, paidUnits: 0, heldUnits: 0, allocatedUnits: 0, orderableUnits: 40,
          preorderStatus: preorder.status, startsAt: supabaseUtcTimestamp(preorder.starts_at), endsAt: supabaseUtcTimestamp(preorder.ends_at), intakeCutoffAt: supabaseUtcTimestamp(capacity.intake_cutoff_at), fulfillmentDate: preorder.fulfillment_date }, snapshot } },
      c6: { status: "unavailable", reason: "not_implemented" },
      c8: { status: "available", data: { ...scope, productId: product.id, preorderItemId: item.id, baseUnitPriceIdr: item.base_price_snapshot_idr,
        effectiveOffer: { state: "none", offer: { offerType: "normal_price", discountBps: 0 }, unitPriceIdr: item.base_price_snapshot_idr, campaign: null },
        snapshot: { provenance: "development_fixture", calculatedAt, preorderVersion: preorder.version, preorderItemVersion: item.version, offerVersion: `seed-no-offer-${preorder.version}` } } },
      hypotheticalScenario: null, history: { status: "not_requested" },
    });
    if(environment.CAMPAIGN_MEMORY_RETRIEVAL){
      try { input.history=await retrieveMemoryHistory(user,scope.businessId,{query:`${business.category} ${product.name} pengalaman budget campaign preorder`,limit:3},configuredEmbedding(environment),now); }
      catch { input.history={status:"unavailable",reason:"read_failed"}; }
      input.calculatedAt=now();
    }
    return input;
  };
}
