"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { readTextFields, type FormState } from "@/lib/form-state";
import { requireUserId } from "@/features/auth/session";
import { BUSINESS_PROFILE_FIELDS, businessProfileSchema } from "@/features/business/schemas";
import { requireBusinessOwner } from "@/features/business/guard";
import { createBusinessForOwner } from "@/features/business/service";
import { BusinessRepositoryError, updateBusinessProfile } from "@/features/business/repository";

const SAVE_FAILED_MESSAGE = "Profil usaha gagal disimpan. Coba lagi beberapa saat lagi.";

function logRepositoryFailure(context: string, error: unknown): void {
  // Hanya kode error yang dicatat; jangan log input profil atau identitas user.
  const code = error instanceof BusinessRepositoryError ? error.code : undefined;
  console.error(`[business] ${context} gagal`, { code });
}

export async function createBusinessAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const userId = await requireUserId();
  const fields = readTextFields(formData, BUSINESS_PROFILE_FIELDS);
  const parsed = businessProfileSchema.safeParse(fields);
  if (!parsed.success) {
    return { status: "error", fieldErrors: z.flattenError(parsed.error).fieldErrors, values: fields };
  }

  try {
    const supabase = await createSupabaseServerClient();
    await createBusinessForOwner(supabase, userId, parsed.data);
  } catch (error) {
    logRepositoryFailure("createBusiness", error);
    return { status: "error", message: SAVE_FAILED_MESSAGE, values: fields };
  }

  redirect("/dashboard");
}

export async function updateBusinessAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const { businessId } = await requireBusinessOwner();
  const fields = readTextFields(formData, BUSINESS_PROFILE_FIELDS);
  const parsed = businessProfileSchema.safeParse(fields);
  if (!parsed.success) {
    return { status: "error", fieldErrors: z.flattenError(parsed.error).fieldErrors, values: fields };
  }

  try {
    const supabase = await createSupabaseServerClient();
    await updateBusinessProfile(supabase, businessId, parsed.data);
  } catch (error) {
    logRepositoryFailure("updateBusiness", error);
    return { status: "error", message: SAVE_FAILED_MESSAGE, values: fields };
  }

  revalidatePath("/dashboard", "layout");
  return { status: "success", message: "Profil usaha tersimpan.", values: fields };
}
