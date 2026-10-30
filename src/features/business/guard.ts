import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { requireUserId } from "@/features/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { findOwnedBusinessId, getBusinessProfile, type BusinessProfile } from "@/features/business/repository";

export const ONBOARDING_PATH = "/onboarding";

export type BusinessOwnerContext = {
  userId: string;
  businessId: string;
};

/**
 * Titik otorisasi utama untuk seluruh fitur dashboard. `businessId` selalu berasal dari keanggotaan
 * owner yang login, bukan dari input browser; modul lain wajib memakai nilai ini untuk filter data.
 */
export const requireBusinessOwner = cache(async (): Promise<BusinessOwnerContext> => {
  const userId = await requireUserId();
  const supabase = await createSupabaseServerClient();
  const businessId = await findOwnedBusinessId(supabase, userId);
  if (!businessId) redirect(ONBOARDING_PATH);
  return { userId, businessId };
});

/** Profil business owner yang login; di-cache per request agar layout dan halaman tidak query dua kali. */
export const getCurrentBusinessProfile = cache(async (): Promise<BusinessProfile> => {
  const { businessId } = await requireBusinessOwner();
  const supabase = await createSupabaseServerClient();
  return getBusinessProfile(supabase, businessId);
});
