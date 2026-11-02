"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { readTextFields, type FormState } from "@/lib/form-state";
import { requireBusinessOwner } from "@/features/business/guard";
import {
  CAPACITY_CREATE_FIELDS,
  CAPACITY_SCHEDULE_FIELDS,
  capacityCreateSchema,
  capacityRefSchema,
  capacityScheduleSchema,
} from "@/features/capacity/schemas";
import { CapacityRepositoryError } from "@/features/capacity/repository";
import {
  changeCapacitySchedule,
  createCapacity,
  type CreateCapacityResult,
  type UpdateCapacityResult,
} from "@/features/capacity/service";

const CAPACITY_PATH = "/dashboard/capacity";
const SAVE_FAILED_MESSAGE = "Kapasitas gagal disimpan. Coba lagi beberapa saat lagi.";
const WINDOW_OUTSIDE_DATE_ERRORS = { fulfillmentWindowEnd: ["Batas pengambilan harus pada tanggal pengambilan"] };

const CREATE_FAILURES: Record<Exclude<CreateCapacityResult, "created">, Pick<FormState, "fieldErrors">> = {
  duplicate: { fieldErrors: { fulfillmentDate: ["Kapasitas produk ini pada tanggal tersebut sudah ada"] } },
  product_unavailable: { fieldErrors: { productId: ["Produk tidak tersedia atau sudah nonaktif"] } },
  cutoff_passed: { fieldErrors: { intakeCutoff: ["Batas pesan sudah lewat"] } },
  window_outside_date: { fieldErrors: WINDOW_OUTSIDE_DATE_ERRORS },
};

const UPDATE_FAILURES: Record<Exclude<UpdateCapacityResult, "updated">, Pick<FormState, "fieldErrors" | "message">> = {
  conflict: { message: "Kapasitas baru saja berubah. Muat ulang halaman, lalu ulangi perubahan." },
  not_found: { message: SAVE_FAILED_MESSAGE },
  window_outside_date: { fieldErrors: WINDOW_OUTSIDE_DATE_ERRORS },
  below_commitment: { fieldErrors: { totalUnits: ["Tidak bisa lebih kecil dari jumlah yang sudah dipesan"] } },
  schedule_frozen: { message: "Jadwal tidak bisa diubah karena dipakai preorder yang sedang berjalan." },
};

function logRepositoryFailure(context: string, error: unknown): void {
  // Hanya kode error yang dicatat; jangan log input atau identitas user.
  const code = error instanceof CapacityRepositoryError ? error.code : undefined;
  console.error(`[capacity] ${context} gagal`, { code });
}

function refreshCapacityPages(): void {
  // Layout dashboard ikut diperbarui karena checklist Ringkasan bergantung pada kapasitas.
  revalidatePath("/dashboard", "layout");
}

export async function createCapacityAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const { businessId } = await requireBusinessOwner();
  const fields = readTextFields(formData, CAPACITY_CREATE_FIELDS);
  const parsed = capacityCreateSchema.safeParse(fields);
  if (!parsed.success) {
    return { status: "error", fieldErrors: z.flattenError(parsed.error).fieldErrors, values: fields };
  }

  try {
    const supabase = await createSupabaseServerClient();
    const result = await createCapacity(supabase, businessId, parsed.data, new Date());
    if (result !== "created") return { status: "error", ...CREATE_FAILURES[result], values: fields };
  } catch (error) {
    logRepositoryFailure("createCapacity", error);
    return { status: "error", message: SAVE_FAILED_MESSAGE, values: fields };
  }

  refreshCapacityPages();
  redirect(CAPACITY_PATH);
}

export async function updateCapacityAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const { businessId } = await requireBusinessOwner();
  const fields = readTextFields(formData, CAPACITY_SCHEDULE_FIELDS);
  const ref = capacityRefSchema.safeParse(readTextFields(formData, ["capacityId", "version"]));
  if (!ref.success) return { status: "error", message: SAVE_FAILED_MESSAGE, values: fields };

  const parsed = capacityScheduleSchema.safeParse(fields);
  if (!parsed.success) {
    return { status: "error", fieldErrors: z.flattenError(parsed.error).fieldErrors, values: fields };
  }

  try {
    const supabase = await createSupabaseServerClient();
    const result = await changeCapacitySchedule(supabase, businessId, ref.data.capacityId, ref.data.version, parsed.data);
    if (result !== "updated") return { status: "error", ...UPDATE_FAILURES[result], values: fields };
  } catch (error) {
    logRepositoryFailure("updateCapacity", error);
    return { status: "error", message: SAVE_FAILED_MESSAGE, values: fields };
  }

  refreshCapacityPages();
  redirect(CAPACITY_PATH);
}
