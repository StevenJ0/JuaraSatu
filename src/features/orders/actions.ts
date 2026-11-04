"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { readTextFields, type FormState } from "@/lib/form-state";
import { requireBusinessOwner } from "@/features/business/guard";
import { OrderRepositoryError, type OrderViolation } from "@/features/orders/repository";
import { MANUAL_ORDER_FIELDS, cancelOrderSchema, manualOrderSchema, orderActionSchema, orderRefSchema } from "@/features/orders/schemas";
import { cancelOrder, createManualOrder, expireOrder, runOrderAction, type OrderOutcome } from "@/features/orders/service";

const ORDERS_PATH = "/dashboard/orders";
const FAILED_MESSAGE = "Pesanan gagal diproses. Coba lagi beberapa saat lagi.";

const VIOLATION_MESSAGES: Record<OrderViolation, string> = {
  VALIDATION_ERROR: "Isian pesanan tidak valid. Periksa lagi lalu ulangi.",
  ORDER_NOT_FOUND: "Pesanan tidak ditemukan.",
  VERSION_CONFLICT: "Pesanan baru saja berubah di tempat lain. Muat ulang halaman, lalu ulangi.",
  ORDER_STATE_INVALID: "Langkah ini sudah tidak berlaku untuk status pesanan sekarang. Muat ulang halaman.",
  PREORDER_NOT_OPEN: "Preorder sudah tidak dibuka, jadi pesanan baru tidak bisa dicatat.",
  CAPACITY_UNAVAILABLE: "Jumlah melebihi sisa kuota atau kapasitas. Kurangi jumlahnya.",
  OFFER_CHANGED: "Harga sudah berubah. Muat ulang halaman untuk melihat harga terbaru.",
  IDEMPOTENCY_CONFLICT: "Form ini sudah dipakai untuk pesanan lain. Muat ulang halaman, lalu isi kembali.",
};

function logFailure(context: string, error: unknown): void {
  // Hanya kode error yang dicatat; jangan log data pemesan.
  const code = error instanceof OrderRepositoryError ? error.code : undefined;
  console.error(`[orders] ${context} gagal`, { code });
}

function refreshOrderPages(): void {
  // Angka preorder dan kapasitas ikut berubah setiap ada perubahan pesanan.
  revalidatePath("/dashboard", "layout");
}

export async function createManualOrderAction(_previous: FormState, formData: FormData): Promise<FormState> {
  await requireBusinessOwner();
  const fields = readTextFields(formData, MANUAL_ORDER_FIELDS);
  const parsed = manualOrderSchema.safeParse(fields);
  if (!parsed.success) {
    return { status: "error", fieldErrors: z.flattenError(parsed.error).fieldErrors, values: fields };
  }

  let orderId: string;
  try {
    const supabase = await createSupabaseServerClient();
    const outcome = await createManualOrder(supabase, parsed.data);
    if (outcome.kind === "rejected") return { status: "error", message: VIOLATION_MESSAGES[outcome.violation], values: fields };
    orderId = outcome.value.orderId;
  } catch (error) {
    logFailure("createManualOrder", error);
    return { status: "error", message: FAILED_MESSAGE, values: fields };
  }

  refreshOrderPages();
  redirect(`${ORDERS_PATH}/${orderId}?saved=created`);
}

async function finishOrderChange(orderId: string, saved: string, run: () => Promise<OrderOutcome<void>>, context: string): Promise<FormState> {
  try {
    const outcome = await run();
    if (outcome.kind === "rejected") return { status: "error", message: VIOLATION_MESSAGES[outcome.violation] };
  } catch (error) {
    logFailure(context, error);
    return { status: "error", message: FAILED_MESSAGE };
  }

  refreshOrderPages();
  redirect(`${ORDERS_PATH}/${orderId}?saved=${saved}`);
}

export async function advanceOrderAction(_previous: FormState, formData: FormData): Promise<FormState> {
  await requireBusinessOwner();
  const parsed = orderActionSchema.safeParse(readTextFields(formData, ["orderId", "version", "action"]));
  if (!parsed.success) return { status: "error", message: FAILED_MESSAGE };

  const { orderId, version, action } = parsed.data;
  const supabase = await createSupabaseServerClient();
  return finishOrderChange(orderId, action, () => runOrderAction(supabase, orderId, version, action), "advanceOrder");
}

export async function cancelOrderAction(_previous: FormState, formData: FormData): Promise<FormState> {
  await requireBusinessOwner();
  const fields = readTextFields(formData, ["orderId", "version", "reason"]);
  const parsed = cancelOrderSchema.safeParse(fields);
  if (!parsed.success) {
    return { status: "error", fieldErrors: z.flattenError(parsed.error).fieldErrors, values: { reason: fields.reason } };
  }

  const { orderId, version, reason } = parsed.data;
  const supabase = await createSupabaseServerClient();
  return finishOrderChange(orderId, "cancelled", () => cancelOrder(supabase, orderId, version, reason), "cancelOrder");
}

export async function expireOrderAction(_previous: FormState, formData: FormData): Promise<FormState> {
  await requireBusinessOwner();
  const parsed = orderRefSchema.safeParse(readTextFields(formData, ["orderId", "version"]));
  if (!parsed.success) return { status: "error", message: FAILED_MESSAGE };

  const { orderId, version } = parsed.data;
  const supabase = await createSupabaseServerClient();
  return finishOrderChange(orderId, "expired", () => expireOrder(supabase, orderId, version), "expireOrder");
}
