import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { summarizeCapacity } from "@/features/capacity/availability";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/service-role";

export const publicPreorderSlugSchema = z.string().min(3).max(160).regex(/^[a-z0-9-]+$/);
const instant = z.iso.datetime({ offset: true });
const units = z.number().int().nonnegative();
const visibility = z.object({ status: z.string(), published_at: instant.nullable() });
const reservation = z.object({
  quantity: units.positive(), state: z.enum(["held", "allocated"]), expires_at: instant.nullable(),
  preorder_item_id: z.uuid().nullable(),
});
const rowSchema = z.object({
  business_id: z.uuid(), slug: publicPreorderSlugSchema, name: z.string().min(1),
  status: z.enum(["published", "closed", "completed", "cancelled"]), published_at: instant,
  fulfillment_date: z.iso.date(), starts_at: instant, ends_at: instant,
  pickup_terms_snapshot: z.object({
    pickup_instructions: z.string().min(1), public_contact: z.string().nullable(),
    intake_cutoff_at: instant, fulfillment_window_end_at: instant,
  }),
  businesses: z.object({ id: z.uuid(), name: z.string().min(1), is_demo: z.boolean() }),
  preorder_items: z.tuple([z.object({
    id: z.uuid(), business_id: z.uuid(), product_id: z.uuid(), capacity_id: z.uuid(),
    product_name_snapshot: z.string().min(1), sku_snapshot: z.string().min(1),
    base_price_snapshot_idr: z.number().int().positive(), quota_units: units.positive(),
    products: z.object({ id: z.uuid(), business_id: z.uuid(), description: z.string().nullable(), photo_path: z.string().max(512).nullable() }),
    production_capacity: z.object({
      id: z.uuid(), business_id: z.uuid(), product_id: z.uuid(), total_units: units,
      capacity_reservations: z.array(reservation),
    }),
  })]),
});

// No customer, cost, membership, payment, or private token columns in this query.
const PUBLIC_COLUMNS = `business_id, slug, name, status, published_at, fulfillment_date, starts_at, ends_at, pickup_terms_snapshot,
  businesses!inner(id, name, is_demo),
  preorder_items(id, business_id, product_id, capacity_id, product_name_snapshot, sku_snapshot, base_price_snapshot_idr, quota_units,
    products!inner(id, business_id, description, photo_path),
    production_capacity!inner(id, business_id, product_id, total_units,
      capacity_reservations(quantity, state, expires_at, preorder_item_id)))`;

export type PublicPreorderState = "open" | "scheduled" | "full" | "closed" | "completed" | "cancelled";
export type PublicPreorder = {
  slug: string;
  name: string;
  business: { name: string; isDemo: boolean };
  product: { name: string; sku: string; description: string | null; photoUrl: string | null };
  offer: { kind: "normal_price"; unitPriceIdr: number };
  state: PublicPreorderState;
  quotaUnits: number;
  availableUnits: number;
  startsAt: string;
  orderDeadlineAt: string;
  fulfillmentDate: string;
  pickupUntil: string;
  pickupInstructions: string;
  publicContact: string | null;
  asOf: string;
};

export class PublicPreorderReadError extends Error {
  constructor() {
    super("PUBLIC_PREORDER_UNAVAILABLE");
    this.name = "PublicPreorderReadError";
  }
}

function parseVisibleRow(data: unknown) {
  if (data === null) return null;
  const head = visibility.safeParse(data);
  if (!head.success) throw new PublicPreorderReadError();
  if (head.data.status === "draft" || head.data.published_at === null) return null;
  const parsed = rowSchema.safeParse(data);
  if (!parsed.success) throw new PublicPreorderReadError();
  const row = parsed.data;
  const [item] = row.preorder_items;
  const capacity = item.production_capacity;
  if (row.business_id !== row.businesses.id || row.business_id !== item.business_id ||
      row.business_id !== item.products.business_id || row.business_id !== capacity.business_id ||
      item.product_id !== item.products.id || item.product_id !== capacity.product_id || item.capacity_id !== capacity.id) {
    throw new PublicPreorderReadError();
  }
  return row;
}

/** Read-only buyer projection. Availability is advisory; C4/database makes the binding capacity decision. */
export async function readPublicPreorder(client: SupabaseClient, slug: unknown, now: Date = new Date()): Promise<PublicPreorder | null> {
  const parsedSlug = publicPreorderSlugSchema.safeParse(slug);
  if (!parsedSlug.success) return null;
  if (!Number.isFinite(now.getTime())) throw new PublicPreorderReadError();
  const { data, error } = await client.from("preorders").select(PUBLIC_COLUMNS)
    .eq("slug", parsedSlug.data).in("status", ["published", "closed", "completed", "cancelled"])
    .not("published_at", "is", null)
    .in("preorder_items.production_capacity.capacity_reservations.state", ["held", "allocated"])
    .maybeSingle();
  if (error) throw new PublicPreorderReadError();
  const row = parseVisibleRow(data);
  if (!row) return null;
  const [item] = row.preorder_items;
  const capacity = item.production_capacity;

  // PostgREST can truncate embedded rows at max_rows. Fail closed instead of overstating availability.
  const counted = await client.from("capacity_reservations").select("order_id", { count: "exact", head: true })
    .eq("business_id", row.business_id).eq("capacity_id", capacity.id).in("state", ["held", "allocated"]);
  if (counted.error || counted.count === null || counted.count !== capacity.capacity_reservations.length) {
    throw new PublicPreorderReadError();
  }
  const capacityAvailable = summarizeCapacity(capacity.total_units, capacity.capacity_reservations.map((r) => ({
    quantity: r.quantity, state: r.state, expiresAt: r.expires_at,
  })), now).available;
  const quotaAvailable = summarizeCapacity(item.quota_units, capacity.capacity_reservations
    .filter((r) => r.preorder_item_id === item.id)
    .map((r) => ({ quantity: r.quantity, state: r.state, expiresAt: r.expires_at })), now).available;
  const available = Math.max(0, Math.min(capacityAvailable, quotaAvailable));
  const deadline = Math.min(Date.parse(row.ends_at), Date.parse(row.pickup_terms_snapshot.intake_cutoff_at));
  const state: PublicPreorderState = row.status !== "published" ? row.status
    : now.getTime() >= deadline ? "closed"
    : now.getTime() < Date.parse(row.starts_at) ? "scheduled"
    : available === 0 ? "full" : "open";
  let photoUrl: string | null = null;
  const path = item.products.photo_path;
  if (path !== null) {
    if (!path.startsWith(`${row.business_id}/`) || !/^[a-zA-Z0-9_./-]+$/.test(path) || path.split("/").some((part) => part === "." || part === "..")) {
      throw new PublicPreorderReadError();
    }
    photoUrl = client.storage.from("product-photos").getPublicUrl(path).data.publicUrl;
  }
  return {
    slug: row.slug, name: row.name, business: { name: row.businesses.name, isDemo: row.businesses.is_demo },
    product: { name: item.product_name_snapshot, sku: item.sku_snapshot, description: item.products.description, photoUrl },
    offer: { kind: "normal_price", unitPriceIdr: item.base_price_snapshot_idr },
    state, quotaUnits: item.quota_units, availableUnits: state === "open" ? available : 0,
    startsAt: row.starts_at, orderDeadlineAt: new Date(deadline).toISOString(),
    fulfillmentDate: row.fulfillment_date, pickupUntil: row.pickup_terms_snapshot.fulfillment_window_end_at,
    pickupInstructions: row.pickup_terms_snapshot.pickup_instructions, publicContact: row.pickup_terms_snapshot.public_contact,
    asOf: now.toISOString(),
  };
}

export async function loadPublicPreorder(slug: unknown): Promise<PublicPreorder | null> {
  if (!publicPreorderSlugSchema.safeParse(slug).success) return null;
  return readPublicPreorder(createSupabaseServiceRoleClient(), slug);
}
