import "server-only";
import { z } from "zod";
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import type { ReservationFact } from "@/features/capacity/availability";
import { summarizePreorder, type PreorderMetrics, type PreorderReservationFact } from "@/features/preorders/metrics";
import type { PreorderInput } from "@/features/preorders/schemas";

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

const preorderRowSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  slug: z.string(),
  status: z.enum(["draft", "published", "closed", "completed", "cancelled"]),
  fulfillment_date: z.string(),
  starts_at: z.string(),
  ends_at: z.string(),
  version: z.number(),
  pickup_terms_snapshot: z
    .object({
      pickup_instructions: z.string(),
      public_contact: z.string().nullable(),
      intake_cutoff_at: z.string(),
      fulfillment_window_end_at: z.string(),
    })
    .nullable(),
  // Selalu satu item (unique preorder_id), tapi PostgREST mengirim daftar karena foreign key-nya gabungan dengan business_id.
  preorder_items: z.tuple([
    z.object({
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
    }),
  ]),
});

const PREORDER_COLUMNS = `id, name, slug, status, fulfillment_date, starts_at, ends_at, version, pickup_terms_snapshot,
  preorder_items(id, product_id, capacity_id, target_units, quota_units, base_price_snapshot_idr, product_name_snapshot,
    production_capacity(total_units, intake_cutoff_at, fulfillment_window_end_at,
      capacity_reservations(quantity, state, expires_at, preorder_item_id, orders(order_status, external_payment_status))))`;

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

function toReservationFact(row: z.infer<typeof reservationRowSchema>): ReservationFact {
  return { quantity: row.quantity, state: row.state, expiresAt: row.expires_at };
}

function toPreorderReservationFact(row: z.infer<typeof reservationRowSchema>): PreorderReservationFact {
  const { order_status: orderStatus, external_payment_status: externalPayment } = row.orders;
  const isVoid = orderStatus === "cancelled" || orderStatus === "expired";
  return { ...toReservationFact(row), payment: isVoid ? "void" : externalPayment === "unpaid" ? "awaiting" : "paid" };
}

function toPreorder(row: z.infer<typeof preorderRowSchema>): Preorder {
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
      new Date(),
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
  return z.array(preorderRowSchema).parse(data).map(toPreorder);
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

export type PreorderTransition = "publish_preorder" | "close_preorder" | "complete_preorder";

export async function transitionPreorder(
  client: SupabaseClient,
  transition: PreorderTransition,
  preorderId: string,
  expectedVersion: number,
): Promise<void> {
  const { error } = await client.rpc(transition, { p_preorder_id: preorderId, p_expected_version: expectedVersion });
  if (error) fail(transition, error);
}
