import "server-only";
import { z } from "zod";
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { summarizeCapacity, type CapacityAvailability } from "@/features/capacity/availability";
import type { CapacityCreateInput, CapacityScheduleInput } from "@/features/capacity/schemas";

const UNIQUE_VIOLATION = "23505";
// Pesan yang dinaikkan trigger `private.guard_capacity_update`.
const BELOW_COMMITMENT = "CAPACITY_BELOW_COMMITMENT";
const SCHEDULE_FROZEN = "CAPACITY_SCHEDULE_FROZEN";

export type CapacityGuardViolation = "below_commitment" | "schedule_frozen";

export class CapacityRepositoryError extends Error {
  constructor(
    operation: string,
    readonly code: string | undefined,
    readonly guardViolation: CapacityGuardViolation | null,
  ) {
    super(`Capacity repository gagal: ${operation}${code ? ` (${code})` : ""}`);
    this.name = "CapacityRepositoryError";
  }

  get isUniqueViolation(): boolean {
    return this.code === UNIQUE_VIOLATION;
  }
}

function fail(operation: string, error: PostgrestError): never {
  const guardViolation = error.message.includes(BELOW_COMMITMENT)
    ? "below_commitment"
    : error.message.includes(SCHEDULE_FROZEN)
      ? "schedule_frozen"
      : null;
  throw new CapacityRepositoryError(operation, error.code, guardViolation);
}

const capacityRowSchema = z.object({
  id: z.uuid(),
  product_id: z.uuid(),
  fulfillment_date: z.string(),
  total_units: z.number(),
  intake_cutoff_at: z.string(),
  fulfillment_window_end_at: z.string(),
  version: z.number(),
  products: z.object({ name: z.string() }),
  capacity_reservations: z.array(
    z.object({
      quantity: z.number(),
      state: z.enum(["held", "allocated", "released"]),
      expires_at: z.string().nullable(),
    }),
  ),
});

const CAPACITY_COLUMNS =
  "id, product_id, fulfillment_date, total_units, intake_cutoff_at, fulfillment_window_end_at, version, products(name), capacity_reservations(quantity, state, expires_at)";

export type Capacity = {
  id: string;
  productId: string;
  productName: string;
  fulfillmentDate: string;
  totalUnits: number;
  intakeCutoffAt: string;
  fulfillmentWindowEndAt: string;
  version: number;
  availability: CapacityAvailability;
};

function toCapacity(row: z.infer<typeof capacityRowSchema>): Capacity {
  const reservations = row.capacity_reservations.map((reservation) => ({
    quantity: reservation.quantity,
    state: reservation.state,
    expiresAt: reservation.expires_at,
  }));
  return {
    id: row.id,
    productId: row.product_id,
    productName: row.products.name,
    fulfillmentDate: row.fulfillment_date,
    totalUnits: row.total_units,
    intakeCutoffAt: row.intake_cutoff_at,
    fulfillmentWindowEndAt: row.fulfillment_window_end_at,
    version: row.version,
    availability: summarizeCapacity(row.total_units, reservations, new Date()),
  };
}

export async function listCapacities(client: SupabaseClient, businessId: string): Promise<Capacity[]> {
  const { data, error } = await client
    .from("production_capacity")
    .select(CAPACITY_COLUMNS)
    .eq("business_id", businessId)
    .order("fulfillment_date", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) fail("listCapacities", error);
  return z.array(capacityRowSchema).parse(data).map(toCapacity);
}

export async function findCapacity(
  client: SupabaseClient,
  businessId: string,
  capacityId: string,
): Promise<Capacity | null> {
  const { data, error } = await client
    .from("production_capacity")
    .select(CAPACITY_COLUMNS)
    .eq("business_id", businessId)
    .eq("id", capacityId)
    .maybeSingle();
  if (error) fail("findCapacity", error);
  return data === null ? null : toCapacity(capacityRowSchema.parse(data));
}

export async function countUsableCapacities(client: SupabaseClient, businessId: string): Promise<number> {
  const { count, error } = await client
    .from("production_capacity")
    .select("id", { count: "exact", head: true })
    .eq("business_id", businessId)
    .gt("total_units", 0);
  if (error) fail("countUsableCapacities", error);
  return count ?? 0;
}

export async function insertCapacity(
  client: SupabaseClient,
  businessId: string,
  input: CapacityCreateInput,
): Promise<void> {
  const { error } = await client.from("production_capacity").insert({
    business_id: businessId,
    product_id: input.productId,
    fulfillment_date: input.fulfillmentDate,
    total_units: input.totalUnits,
    intake_cutoff_at: input.intakeCutoff,
    fulfillment_window_end_at: input.fulfillmentWindowEnd,
  });
  if (error) fail("insertCapacity", error);
}

/** Mengembalikan false bila baris sudah berubah sejak `expectedVersion`; `version` dinaikkan trigger database. */
export async function updateCapacitySchedule(
  client: SupabaseClient,
  businessId: string,
  capacityId: string,
  expectedVersion: number,
  input: CapacityScheduleInput,
): Promise<boolean> {
  const { data, error } = await client
    .from("production_capacity")
    .update({
      total_units: input.totalUnits,
      intake_cutoff_at: input.intakeCutoff,
      fulfillment_window_end_at: input.fulfillmentWindowEnd,
    })
    .eq("business_id", businessId)
    .eq("id", capacityId)
    .eq("version", expectedVersion)
    .select("id");
  if (error) fail("updateCapacitySchedule", error);
  return z.array(z.object({ id: z.uuid() })).parse(data).length === 1;
}
