"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { readTextFields, type FormState } from "@/lib/form-state";
import { requireBusinessOwner } from "@/features/business/guard";
import { OrderRepositoryError, type OrderViolation } from "@/features/orders/repository";
import {
  MANUAL_ORDER_FIELDS,
  STANDALONE_MANUAL_ORDER_FIELDS,
  acceptLatePaymentSchema,
  cancelOrderSchema,
  declineLatePaymentSchema,
  manualOrderSchema,
  orderActionSchema,
  orderRefSchema,
  resolveProductionCostSchema,
  standaloneManualOrderSchema,
} from "@/features/orders/schemas";
import {
  acceptLatePayment,
  cancelOrder,
  createManualOrder,
  createStandaloneManualOrder,
  declineLatePayment,
  expireOrder,
  resolveProductionCost,
  runOrderAction,
  type OrderOutcome,
} from "@/features/orders/service";

const ORDERS_PATH = "/dashboard/orders";
const FAILED_MESSAGE = "Pesanan gagal diproses. Coba lagi beberapa saat lagi.";

const LATE_PAYMENT_FULL_MESSAGE = "Kuota atau kapasitas sudah terpakai pesanan lain, jadi pembayaran ini belum bisa diterima. Pilih tidak diterima atau tambah kapasitas.";

const VIOLATION_MESSAGES: Record<OrderViolation, string> = {
  VALIDATION_ERROR: "Isian pesanan tidak valid. Periksa lagi lalu ulangi.",
  ORDER_NOT_FOUND: "Pesanan tidak ditemukan.",
  VERSION_CONFLICT: "Pesanan baru saja berubah di tempat lain. Muat ulang halaman, lalu ulangi.",
  ORDER_STATE_INVALID: "Langkah ini sudah tidak berlaku untuk status pesanan sekarang. Muat ulang halaman.",
  PREORDER_NOT_OPEN: "Preorder sudah tidak dibuka, jadi pesanan baru tidak bisa dicatat.",
  CAPACITY_UNAVAILABLE: "Jumlah melebihi sisa kuota atau kapasitas. Kurangi jumlahnya.",
  OFFER_CHANGED: "Harga sudah berubah. Muat ulang halaman untuk melihat harga terbaru.",
  IDEMPOTENCY_CONFLICT: "Form ini sudah dipakai untuk pesanan lain. Muat ulang halaman, lalu isi kembali.",
  SCHEDULE_CLOSED: "Jadwal pengambilan ini sudah lewat. Pilih jadwal lain.",
  PRODUCT_INACTIVE: "Produk pada jadwal ini nonaktif. Aktifkan produknya atau pilih jadwal lain.",
  REFUND_NOTE_REQUIRED: "Pesanan ini sudah lunas. Tulis catatan pengembalian sebelum membatalkan.",
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

export async function createStandaloneManualOrderAction(_previous: FormState, formData: FormData): Promise<FormState> {
  await requireBusinessOwner();
  const fields = readTextFields(formData, STANDALONE_MANUAL_ORDER_FIELDS);
  const parsed = standaloneManualOrderSchema.safeParse(fields);
  if (!parsed.success) {
    return { status: "error", fieldErrors: z.flattenError(parsed.error).fieldErrors, values: fields };
  }

  let orderId: string;
  try {
    const supabase = await createSupabaseServerClient();
    const outcome = await createStandaloneManualOrder(supabase, parsed.data);
    if (outcome.kind === "rejected") return { status: "error", message: VIOLATION_MESSAGES[outcome.violation], values: fields };
    orderId = outcome.value.orderId;
  } catch (error) {
    logFailure("createStandaloneManualOrder", error);
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
  const fields = readTextFields(formData, ["orderId", "version", "reason", "refundNote"]);
  const values = { reason: fields.reason, refundNote: fields.refundNote };
  const parsed = cancelOrderSchema.safeParse(fields);
  if (!parsed.success) {
    return { status: "error", fieldErrors: z.flattenError(parsed.error).fieldErrors, values };
  }

  const { orderId, version, reason, refundNote } = parsed.data;
  const supabase = await createSupabaseServerClient();
  const state = await finishOrderChange(orderId, "cancelled", () => cancelOrder(supabase, orderId, version, reason, refundNote), "cancelOrder");
  return { ...state, values };
}

export async function resolveProductionCostAction(_previous: FormState, formData: FormData): Promise<FormState> {
  await requireBusinessOwner();
  const fields = readTextFields(formData, ["orderId", "version", "costPerUnit", "quality", "note"]);
  const values = { costPerUnit: fields.costPerUnit, quality: fields.quality, note: fields.note };
  const parsed = resolveProductionCostSchema.safeParse(fields);
  if (!parsed.success) {
    return { status: "error", fieldErrors: z.flattenError(parsed.error).fieldErrors, values };
  }

  const { orderId, version, costPerUnitIdr, quality, note } = parsed.data;
  const supabase = await createSupabaseServerClient();
  const state = await finishOrderChange(orderId, "cost_resolved", () => resolveProductionCost(supabase, orderId, version, { costPerUnitIdr, quality, note }), "resolveProductionCost");
  return { ...state, values };
}

export async function acceptLatePaymentAction(_previous: FormState, formData: FormData): Promise<FormState> {
  await requireBusinessOwner();
  const parsed = acceptLatePaymentSchema.safeParse(readTextFields(formData, ["orderId", "version", "paymentId"]));
  if (!parsed.success) return { status: "error", message: FAILED_MESSAGE };

  const { orderId, version, paymentId } = parsed.data;
  const supabase = await createSupabaseServerClient();
  const state = await finishOrderChange(orderId, "late_accepted", () => acceptLatePayment(supabase, orderId, version, paymentId), "acceptLatePayment");
  return state.message === VIOLATION_MESSAGES.CAPACITY_UNAVAILABLE ? { ...state, message: LATE_PAYMENT_FULL_MESSAGE } : state;
}

export async function declineLatePaymentAction(_previous: FormState, formData: FormData): Promise<FormState> {
  await requireBusinessOwner();
  const fields = readTextFields(formData, ["orderId", "version", "note"]);
  const parsed = declineLatePaymentSchema.safeParse(fields);
  if (!parsed.success) {
    return { status: "error", fieldErrors: z.flattenError(parsed.error).fieldErrors, values: { note: fields.note } };
  }

  const { orderId, version, note } = parsed.data;
  const supabase = await createSupabaseServerClient();
  return finishOrderChange(orderId, "late_declined", () => declineLatePayment(supabase, orderId, version, note), "declineLatePayment");
}

export async function expireOrderAction(_previous: FormState, formData: FormData): Promise<FormState> {
  await requireBusinessOwner();
  const parsed = orderRefSchema.safeParse(readTextFields(formData, ["orderId", "version"]));
  if (!parsed.success) return { status: "error", message: FAILED_MESSAGE };

  const { orderId, version } = parsed.data;
  const supabase = await createSupabaseServerClient();
  return finishOrderChange(orderId, "expired", () => expireOrder(supabase, orderId, version), "expireOrder");
}
