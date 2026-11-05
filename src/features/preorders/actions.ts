"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { readTextFields, type FormState } from "@/lib/form-state";
import { requireBusinessOwner } from "@/features/business/guard";
import { PREORDER_FIELDS, preorderRefSchema, preorderSchema } from "@/features/preorders/schemas";
import { PreorderRepositoryError, type PreorderTransition, type PreorderViolation } from "@/features/preorders/repository";
import { createPreorderDraft, runPreorderTransition, updatePreorderDraft } from "@/features/preorders/service";

const PREORDERS_PATH = "/dashboard/preorders";
const SAVE_FAILED_MESSAGE = "Preorder gagal disimpan. Coba lagi beberapa saat lagi.";

const VIOLATION_STATES: Record<PreorderViolation, Pick<FormState, "message" | "fieldErrors">> = {
  NOT_FOUND: { message: "Preorder tidak ditemukan." },
  VERSION_CONFLICT: { message: "Preorder baru saja berubah di tempat lain. Muat ulang halaman, lalu ulangi." },
  NOT_DRAFT: { message: "Preorder ini bukan draf lagi, jadi tidak bisa diubah." },
  NOT_PUBLISHED: { message: "Hanya preorder yang sedang dibuka yang bisa ditutup." },
  NOT_CLOSED: { message: "Tutup preorder dulu sebelum menyelesaikannya." },
  INPUT_INVALID: { message: "Isian preorder tidak valid. Periksa nama, target, dan kuota." },
  CAPACITY_NOT_FOUND: { fieldErrors: { capacityId: ["Jadwal produksi tidak tersedia. Pilih jadwal lain."] } },
  PRODUCT_INACTIVE: { fieldErrors: { capacityId: ["Produk pada jadwal ini nonaktif. Aktifkan produknya atau pilih jadwal lain."] } },
  SCHEDULE_INVALID: {
    message: "Jadwal tidak sah. Waktu tutup harus setelah waktu mulai, belum lewat, dan tidak melewati batas pesan kapasitas.",
    fieldErrors: { endsAt: ["Waktu tutup harus belum lewat dan tidak melewati batas pesan kapasitas."] },
  },
  QUOTA_OVER_CAPACITY: { message: "Kuota melebihi sisa kapasitas. Turunkan kuota atau tambah kapasitas produksi." },
  DATE_TAKEN: { message: "Sudah ada preorder yang dibuka untuk tanggal pengambilan ini. Tutup preorder itu dulu atau pilih tanggal lain." },
  ORDERS_UNRESOLVED: { message: "Masih ada pesanan yang belum selesai. Selesaikan pesanan itu dulu." },
  HAS_ORDERS: { message: "Preorder ini sudah punya pesanan, jadi tidak bisa dibatalkan. Tutup preorder bila ingin berhenti menerima pesanan." },
};

function logRepositoryFailure(context: string, error: unknown): void {
  // Hanya kode error yang dicatat; jangan log input atau identitas user.
  const code = error instanceof PreorderRepositoryError ? error.code : undefined;
  console.error(`[preorders] ${context} gagal`, { code });
}

export async function createPreorderAction(_previous: FormState, formData: FormData): Promise<FormState> {
  await requireBusinessOwner();
  const fields = readTextFields(formData, PREORDER_FIELDS);
  const parsed = preorderSchema.safeParse(fields);
  if (!parsed.success) {
    return { status: "error", fieldErrors: z.flattenError(parsed.error).fieldErrors, values: fields };
  }

  let preorderId: string;
  try {
    const supabase = await createSupabaseServerClient();
    const result = await createPreorderDraft(supabase, parsed.data);
    if (result.kind === "rejected") return { status: "error", ...VIOLATION_STATES[result.violation], values: fields };
    preorderId = result.preorderId;
  } catch (error) {
    logRepositoryFailure("createPreorder", error);
    return { status: "error", message: SAVE_FAILED_MESSAGE, values: fields };
  }

  revalidatePath("/dashboard", "layout");
  redirect(`${PREORDERS_PATH}/${preorderId}?saved=created`);
}

export async function updatePreorderAction(_previous: FormState, formData: FormData): Promise<FormState> {
  await requireBusinessOwner();
  const fields = readTextFields(formData, PREORDER_FIELDS);
  const ref = preorderRefSchema.safeParse(readTextFields(formData, ["preorderId", "version"]));
  if (!ref.success) return { status: "error", message: SAVE_FAILED_MESSAGE, values: fields };

  const parsed = preorderSchema.safeParse(fields);
  if (!parsed.success) {
    return { status: "error", fieldErrors: z.flattenError(parsed.error).fieldErrors, values: fields };
  }

  try {
    const supabase = await createSupabaseServerClient();
    const result = await updatePreorderDraft(supabase, ref.data.preorderId, ref.data.version, parsed.data);
    if (result.kind === "rejected") return { status: "error", ...VIOLATION_STATES[result.violation], values: fields };
  } catch (error) {
    logRepositoryFailure("updatePreorder", error);
    return { status: "error", message: SAVE_FAILED_MESSAGE, values: fields };
  }

  revalidatePath("/dashboard", "layout");
  redirect(`${PREORDERS_PATH}/${ref.data.preorderId}?saved=updated`);
}

async function runTransition(transition: PreorderTransition, saved: string, formData: FormData): Promise<FormState> {
  await requireBusinessOwner();
  const ref = preorderRefSchema.safeParse(readTextFields(formData, ["preorderId", "version"]));
  if (!ref.success) return { status: "error", message: SAVE_FAILED_MESSAGE };

  try {
    const supabase = await createSupabaseServerClient();
    const result = await runPreorderTransition(supabase, transition, ref.data.preorderId, ref.data.version);
    if (result.kind === "rejected") return { status: "error", message: VIOLATION_STATES[result.violation].message ?? SAVE_FAILED_MESSAGE };
  } catch (error) {
    logRepositoryFailure(transition, error);
    return { status: "error", message: SAVE_FAILED_MESSAGE };
  }

  revalidatePath("/dashboard", "layout");
  redirect(`${PREORDERS_PATH}/${ref.data.preorderId}?saved=${saved}`);
}

export async function publishPreorderAction(_previous: FormState, formData: FormData): Promise<FormState> {
  return runTransition("publish_preorder", "published", formData);
}

export async function closePreorderAction(_previous: FormState, formData: FormData): Promise<FormState> {
  return runTransition("close_preorder", "closed", formData);
}

export async function completePreorderAction(_previous: FormState, formData: FormData): Promise<FormState> {
  return runTransition("complete_preorder", "completed", formData);
}

export async function cancelPreorderDraftAction(_previous: FormState, formData: FormData): Promise<FormState> {
  return runTransition("cancel_preorder_draft", "cancelled", formData);
}

export async function cancelPublishedPreorderAction(_previous: FormState, formData: FormData): Promise<FormState> {
  return runTransition("cancel_published_preorder", "cancelled_published", formData);
}
