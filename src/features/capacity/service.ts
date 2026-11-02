import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { wibDateOf } from "@/lib/wib-time";
import type { CapacityCreateInput, CapacityScheduleInput } from "@/features/capacity/schemas";
import {
  CapacityRepositoryError,
  findCapacity,
  insertCapacity,
  updateCapacitySchedule,
  type CapacityGuardViolation,
} from "@/features/capacity/repository";
import { findProduct } from "@/features/products/repository";

export type CreateCapacityResult =
  | "created"
  | "duplicate"
  | "product_unavailable"
  | "cutoff_passed"
  | "window_outside_date";

export type UpdateCapacityResult = "updated" | "conflict" | "not_found" | "window_outside_date" | CapacityGuardViolation;

/** Satu baris kapasitas mewakili satu tanggal pengambilan, jadi batas pengambilannya harus jatuh di tanggal itu (WIB). */
function isWindowEndOnDate(fulfillmentWindowEnd: string, fulfillmentDate: string): boolean {
  return wibDateOf(fulfillmentWindowEnd) === fulfillmentDate;
}

export async function createCapacity(
  client: SupabaseClient,
  businessId: string,
  input: CapacityCreateInput,
  now: Date,
): Promise<CreateCapacityResult> {
  if (Date.parse(input.intakeCutoff) <= now.getTime()) return "cutoff_passed";
  if (!isWindowEndOnDate(input.fulfillmentWindowEnd, input.fulfillmentDate)) return "window_outside_date";

  const product = await findProduct(client, businessId, input.productId);
  if (!product?.isActive) return "product_unavailable";

  try {
    await insertCapacity(client, businessId, input);
    return "created";
  } catch (error) {
    if (error instanceof CapacityRepositoryError && error.isUniqueViolation) return "duplicate";
    throw error;
  }
}

/** Batas komitmen dan jadwal beku ditegakkan trigger database, yang mengunci baris yang sama dengan proses checkout. */
export async function changeCapacitySchedule(
  client: SupabaseClient,
  businessId: string,
  capacityId: string,
  expectedVersion: number,
  input: CapacityScheduleInput,
): Promise<UpdateCapacityResult> {
  const current = await findCapacity(client, businessId, capacityId);
  if (!current) return "not_found";
  if (current.version !== expectedVersion) return "conflict";
  if (!isWindowEndOnDate(input.fulfillmentWindowEnd, current.fulfillmentDate)) return "window_outside_date";

  try {
    const updated = await updateCapacitySchedule(client, businessId, capacityId, expectedVersion, input);
    return updated ? "updated" : "conflict";
  } catch (error) {
    if (error instanceof CapacityRepositoryError && error.guardViolation) return error.guardViolation;
    throw error;
  }
}
