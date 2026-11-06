import "server-only";
import { z } from "zod";
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import type { ReservationFact } from "@/features/capacity/availability";
import { toPreorderContext, toPublicPreorder, type PreorderContext, type PublicPreorder } from "@/features/preorders/context";
import { computeOrderableUnits, summarizePreorder, type PreorderMetrics, type PreorderReservationFact } from "@/features/preorders/metrics";
import type { PreorderInput } from "@/features/preorders/schemas";
import { productPhotoUrls } from "@/features/products/repository";
import { COST_QUALITIES } from "@/features/products/schemas";

const UNIQUE_VIOLATION = "23505";
const VIOLATION_PATTERN = /PREORDER_([A-Z_]+)/;

export const PREORDER_VIOLATIONS = [
  "NOT_FOUND",
  "VERSION_CONFLICT",
  "NOT_DRAFT",
  "NOT_PUBLISHED",
  "NOT_CLOSED",
  "INPUT_INVALID",
  "CAPACITY_NOT_FOUND",
  "PRODUCT_INACTIVE",
  "SCHEDULE_INVALID",
  "QUOTA_OVER_CAPACITY",
  "DATE_TAKEN",
  "ORDERS_UNRESOLVED",
  "HAS_ORDERS",
] as const;
export type PreorderViolation = (typeof PREORDER_VIOLATIONS)[number];

function parseViolation(message: string): PreorderViolation | null {
  const code = VIOLATION_PATTERN.exec(message)?.[1];
  return PREORDER_VIOLATIONS.find((violation) => violation === code) ?? null;
}

export class PreorderRepositoryError extends Error {
  constructor(
    operation: string,
    readonly code: string | undefined,
    readonly violation: PreorderViolation | null,
  ) {
    super(`Preorder repository gagal: ${operation}${code ? ` (${code})` : ""}`);
    this.name = "PreorderRepositoryError";
  }

  /** Satu-satunya unique yang bisa dilanggar saat membuat draf adalah slug. */
  get isDuplicateSlug(): boolean {
    return this.code === UNIQUE_VIOLATION && this.violation === null;
  }
}

function fail(operation: string, error: PostgrestError): never {
  throw new PreorderRepositoryError(operation, error.code, parseViolation(error.message));
}

const reservationRowSchema = z.object({
  quantity: z.number(),
  state: z.enum(["held", "allocated", "released"]),
  expires_at: z.string().nullable(),
  preorder_item_id: z.string().nullable(),
  orders: z.object({ order_status: z.string(), external_payment_status: z.string().nullable() }),
});

const pickupTermsSchema = z.object({
  pickup_instructions: z.string(),
  public_contact: z.string().nullable(),
  intake_cutoff_at: z.string(),
  fulfillment_window_end_at: z.string(),
});

const preorderItemRowSchema = z.object({
  id: z.uuid(),
  product_id: z.uuid(),
  capacity_id: z.uuid(),
  target_units: z.number(),
  quota_units: z.number(),
  base_price_snapshot_idr: z.number(),
  product_name_snapshot: z.string(),
  production_capacity: z.object({
    total_units: z.number(),
    intake_cutoff_at: z.string(),
    fulfillment_window_end_at: z.string(),
    capacity_reservations: z.array(reservationRowSchema),
  }),
});

const preorderRowSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  slug: z.string(),
  status: z.enum(["draft", "published", "closed", "completed", "cancelled"]),
  fulfillment_date: z.string(),
  starts_at: z.string(),
  ends_at: z.string(),
  version: z.number(),
  pickup_terms_snapshot: pickupTermsSchema.nullable(),
  // Selalu satu item (unique preorder_id), tapi PostgREST mengirim daftar karena foreign key-nya gabungan dengan business_id.
  preorder_items: z.tuple([preorderItemRowSchema]),
});

const PREORDER_ROOT_COLUMNS = "id, name, slug, status, fulfillment_date, starts_at, ends_at, version, pickup_terms_snapshot";
const PREORDER_ITEM_COLUMNS = `id, product_id, capacity_id, target_units, quota_units, base_price_snapshot_idr, product_name_snapshot,
    production_capacity(total_units, intake_cutoff_at, fulfillment_window_end_at,
      capacity_reservations(quantity, state, expires_at, preorder_item_id, orders(order_status, external_payment_status)))`;
const PREORDER_COLUMNS = `${PREORDER_ROOT_COLUMNS}, preorder_items(${PREORDER_ITEM_COLUMNS})`;

export type PreorderStatus = z.infer<typeof preorderRowSchema>["status"];
export type PickupTerms = { pickupInstructions: string; publicContact: string | null };

export type Preorder = {
  id: string;
  name: string;
  slug: string;
  status: PreorderStatus;
  fulfillmentDate: string;
  startsAt: string;
  endsAt: string;
  version: number;
  productId: string;
  productName: string;
  capacityId: string;
  targetUnits: number;
  quotaUnits: number;
  basePriceIdr: number;
  intakeCutoffAt: string;
  fulfillmentWindowEndAt: string;
  /** Hanya ada setelah terbit; ketentuan pengambilan dibekukan saat itu (D-13). */
  frozenTerms: PickupTerms | null;
  metrics: PreorderMetrics;
};

function toReservationFact(row: Pick<z.infer<typeof reservationRowSchema>, "quantity" | "state" | "expires_at">): ReservationFact {
  return { quantity: row.quantity, state: row.state, expiresAt: row.expires_at };
}

function toPreorderReservationFact(row: z.infer<typeof reservationRowSchema>): PreorderReservationFact {
  const { order_status: orderStatus, external_payment_status: externalPayment } = row.orders;
  const isVoid = orderStatus === "cancelled" || orderStatus === "expired";
  return { ...toReservationFact(row), payment: isVoid ? "void" : externalPayment === "unpaid" ? "awaiting" : "paid" };
}

function toPreorder(row: z.infer<typeof preorderRowSchema>, now: Date = new Date()): Preorder {
  const [item] = row.preorder_items;
  const capacity = item.production_capacity;
  const terms = row.pickup_terms_snapshot;
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    status: row.status,
    fulfillmentDate: row.fulfillment_date,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    version: row.version,
    productId: item.product_id,
    productName: item.product_name_snapshot,
    capacityId: item.capacity_id,
    targetUnits: item.target_units,
    quotaUnits: item.quota_units,
    basePriceIdr: item.base_price_snapshot_idr,
    // Setelah terbit jadwal kapasitas dibekukan database, sehingga nilainya sama dengan snapshot.
    intakeCutoffAt: terms?.intake_cutoff_at ?? capacity.intake_cutoff_at,
    fulfillmentWindowEndAt: terms?.fulfillment_window_end_at ?? capacity.fulfillment_window_end_at,
    frozenTerms: terms && { pickupInstructions: terms.pickup_instructions, publicContact: terms.public_contact },
    metrics: summarizePreorder(
      {
        targetUnits: item.target_units,
        quotaUnits: item.quota_units,
        capacityTotalUnits: capacity.total_units,
        capacityReservations: capacity.capacity_reservations.map(toReservationFact),
        preorderReservations: capacity.capacity_reservations
          .filter((reservation) => reservation.preorder_item_id === item.id)
          .map(toPreorderReservationFact),
      },
      now,
    ),
  };
}

export async function listPreorders(client: SupabaseClient, businessId: string): Promise<Preorder[]> {
  const { data, error } = await client
    .from("preorders")
    .select(PREORDER_COLUMNS)
    .eq("business_id", businessId)
    .order("created_at", { ascending: false });
  if (error) fail("listPreorders", error);
  return z.array(preorderRowSchema).parse(data).map((row) => toPreorder(row));
}

export async function findPreorder(client: SupabaseClient, businessId: string, preorderId: string): Promise<Preorder | null> {
  const { data, error } = await client
    .from("preorders")
    .select(PREORDER_COLUMNS)
    .eq("business_id", businessId)
    .eq("id", preorderId)
    .maybeSingle();
  if (error) fail("findPreorder", error);
  return data === null ? null : toPreorder(preorderRowSchema.parse(data));
}

// Pembeli hanya melihat preorder yang pernah terbit. Draf dan yang dibatalkan sama dengan tidak ditemukan, agar keberadaannya tidak bocor.
const PUBLIC_STATUSES = ["published", "closed", "completed"] as const;

const preorderOfferSchema = z.object({ discount_bps: z.number(), final_unit_price_idr: z.number() });

const publicPreorderRowSchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  name: z.string(),
  status: z.enum(PUBLIC_STATUSES),
  fulfillment_date: z.string(),
  starts_at: z.string(),
  ends_at: z.string(),
  version: z.number(),
  pickup_terms_snapshot: pickupTermsSchema,
  businesses: z.object({ name: z.string() }),
  preorder_items: z.tuple([
    z.object({
      id: z.uuid(),
      quota_units: z.number(),
      base_price_snapshot_idr: z.number(),
      product_name_snapshot: z.string(),
      products: z.object({ description: z.string().nullable(), photo_path: z.string().nullable() }),
      production_capacity: z.object({
        total_units: z.number(),
        capacity_reservations: z.array(reservationRowSchema.omit({ orders: true })),
      }),
    }),
  ]),
});

// Tanpa kolom biaya dan tanpa tabel pesanan, jadi data privat tidak pernah keluar dari database untuk permintaan ini.
const PUBLIC_PREORDER_COLUMNS = `id, slug, name, status, fulfillment_date, starts_at, ends_at, version, pickup_terms_snapshot,
  businesses(name),
  preorder_items(id, quota_units, base_price_snapshot_idr, product_name_snapshot,
    products(description, photo_path),
    production_capacity(total_units, capacity_reservations(quantity, state, expires_at, preorder_item_id)))`;

/** Kontrak C1 untuk halaman pembeli. `client` wajib service role, karena tamu tidak punya akses ke tabel preorder. */
export async function findPublicPreorder(client: SupabaseClient, slug: string, now: Date = new Date()): Promise<PublicPreorder | null> {
  const { data, error } = await client
    .from("preorders")
    .select(PUBLIC_PREORDER_COLUMNS)
    .eq("slug", slug)
    .in("status", PUBLIC_STATUSES)
    .maybeSingle();
  if (error) fail("findPublicPreorder", error);
  if (data === null) return null;

  const row = publicPreorderRowSchema.parse(data);
  const [item] = row.preorder_items;
  const capacity = item.production_capacity;
  const terms = row.pickup_terms_snapshot;
  // Query terpisah dari baris preorder. Harga tetap dicek ulang saat memesan, dan selisihnya ditolak dengan OFFER_CHANGED.
  const { data: offerData, error: offerError } = await client.rpc("read_preorder_offer", { p_preorder_id: row.id });
  if (offerError) fail("findPublicPreorder", offerError);
  const offer = preorderOfferSchema.parse(offerData);
  return toPublicPreorder(
    {
      slug: row.slug,
      name: row.name,
      status: row.status,
      orderableUnits: computeOrderableUnits(
        {
          quotaUnits: item.quota_units,
          capacityTotalUnits: capacity.total_units,
          capacityReservations: capacity.capacity_reservations.map(toReservationFact),
          preorderReservations: capacity.capacity_reservations
            .filter((reservation) => reservation.preorder_item_id === item.id)
            .map(toReservationFact),
        },
        now,
      ),
      unitPriceIdr: offer.final_unit_price_idr,
      basePriceIdr: item.base_price_snapshot_idr,
      discountBps: offer.discount_bps,
      fulfillmentDate: row.fulfillment_date,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      intakeCutoffAt: terms.intake_cutoff_at,
      fulfillmentWindowEndAt: terms.fulfillment_window_end_at,
      businessName: row.businesses.name,
      product: {
        name: item.product_name_snapshot,
        description: item.products.description,
        ...productPhotoUrls(client, item.products.photo_path),
      },
      pickup: { instructions: terms.pickup_instructions, publicContact: terms.public_contact },
      version: row.version,
    },
    now,
  );
}

const preorderContextRowSchema = preorderRowSchema.extend({
  businesses: z.object({ name: z.string(), categories: z.array(z.string()), description: z.string().nullable() }),
  preorder_items: z.tuple([
    preorderItemRowSchema.extend({
      products: z.object({ description: z.string().nullable(), cost_quality: z.enum(COST_QUALITIES), is_active: z.boolean() }),
    }),
  ]),
});

// Satu query, sehingga semua angkanya berasal dari satu snapshot database.
const PREORDER_CONTEXT_COLUMNS = `${PREORDER_ROOT_COLUMNS},
  businesses(name, categories, description),
  preorder_items(${PREORDER_ITEM_COLUMNS}, products(description, cost_quality, is_active))`;

/** Kontrak C1 untuk fitur AI. `client` wajib client bersesi dan `businessId` dari `requireBusinessOwner()`, bukan dari browser. */
export async function findPreorderContext(
  client: SupabaseClient,
  businessId: string,
  preorderId: string,
  now: Date = new Date(),
): Promise<PreorderContext | null> {
  const { data, error } = await client
    .from("preorders")
    .select(PREORDER_CONTEXT_COLUMNS)
    .eq("business_id", businessId)
    .eq("id", preorderId)
    .maybeSingle();
  if (error) fail("findPreorderContext", error);
  if (data === null) return null;

  const row = preorderContextRowSchema.parse(data);
  const { products } = row.preorder_items[0];
  return toPreorderContext(
    toPreorder(row, now),
    row.businesses,
    { description: products.description, costQuality: products.cost_quality, isActive: products.is_active },
    now,
  );
}

export async function savePreorderDraft(
  client: SupabaseClient,
  input: PreorderInput,
  target: { kind: "new"; slug: string } | { kind: "existing"; preorderId: string; expectedVersion: number },
): Promise<string> {
  const { data, error } = await client.rpc("save_preorder_draft", {
    p_preorder_id: target.kind === "existing" ? target.preorderId : null,
    p_expected_version: target.kind === "existing" ? target.expectedVersion : null,
    p_slug: target.kind === "new" ? target.slug : null,
    p_name: input.name,
    p_capacity_id: input.capacityId,
    p_target_units: input.targetUnits,
    p_quota_units: input.quotaUnits,
    p_starts_at: input.startsAt,
    p_ends_at: input.endsAt,
  });
  if (error) fail("savePreorderDraft", error);
  return z.uuid().parse(data);
}

export type PreorderTransition = "publish_preorder" | "complete_preorder" | "cancel_preorder_draft" | "cancel_published_preorder";

export async function closePreorderRecord(client: SupabaseClient, preorderId: string, expectedVersion: number, reason: string): Promise<void> {
  const { error } = await client.rpc("close_preorder", { p_preorder_id: preorderId, p_expected_version: expectedVersion, p_reason: reason });
  if (error) fail("close_preorder", error);
}

const closeEventSchema = z.object({ occurred_at: z.string(), safe_details_json: z.object({ reason: z.string() }) });
export type PreorderCloseNote = { reason: string; closedAt: string };

/** Catatan penutupan terakhir dari `domain_events`. Null untuk preorder yang ditutup sebelum alasan dicatat. */
export async function findPreorderCloseNote(client: SupabaseClient, businessId: string, preorderId: string): Promise<PreorderCloseNote | null> {
  const { data, error } = await client
    .from("domain_events")
    .select("occurred_at, safe_details_json")
    .eq("business_id", businessId)
    .eq("entity_type", "preorder")
    .eq("entity_id", preorderId)
    .eq("event_type", "preorder_closed")
    .order("occurred_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) fail("findPreorderCloseNote", error);
  if (data === null) return null;
  const row = closeEventSchema.parse(data);
  return { reason: row.safe_details_json.reason, closedAt: row.occurred_at };
}

export async function transitionPreorder(
  client: SupabaseClient,
  transition: PreorderTransition,
  preorderId: string,
  expectedVersion: number,
): Promise<void> {
  const { error } = await client.rpc(transition, { p_preorder_id: preorderId, p_expected_version: expectedVersion });
  if (error) fail(transition, error);
}
