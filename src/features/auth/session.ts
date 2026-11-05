import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { LOGIN_PATH } from "@/lib/supabase/proxy";

/** ID user yang login berdasarkan JWT terverifikasi, atau null. Di-cache per request. */
export const getCurrentUserId = cache(async (): Promise<string | null> => {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data) return null;
  const subject: unknown = data.claims.sub;
  return typeof subject === "string" && subject.length > 0 ? subject : null;
});

// Sama dengan masa berlaku link reset bawaan Supabase.
const RECOVERY_WINDOW_SECONDS = 60 * 60;
const authMethodsSchema = z.array(z.object({ method: z.string(), timestamp: z.number() }));
// Supabase menandai session dari link reset sebagai `otp` (dicek langsung di versi lokal). Keduanya berarti pemilik baru saja
// membuktikan menguasai emailnya, sama kuatnya dengan link reset. Login dengan password tetap tidak cukup.
const EMAIL_PROOF_METHODS = new Set(["otp", "recovery"]);

/** Isi `amr` dari JWT sudah diverifikasi `getClaims`. Dipisah agar aturan waktunya bisa diuji tanpa Supabase. */
export function isRecentRecovery(authMethods: unknown, nowSeconds: number): boolean {
  const parsed = authMethodsSchema.safeParse(authMethods);
  if (!parsed.success) return false;
  return parsed.data.some(({ method, timestamp }) => EMAIL_PROOF_METHODS.has(method) && nowSeconds - timestamp <= RECOVERY_WINDOW_SECONDS);
}

/**
 * Membuat password baru hanya boleh dari session hasil link reset. Session login biasa tidak cukup, karena perangkat
 * yang tertinggal dalam keadaan masuk bisa mengganti password tanpa mengetahui password lama.
 */
export async function hasRecoverySession(): Promise<boolean> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data) return false;
  return isRecentRecovery(data.claims.amr, Math.floor(Date.now() / 1000));
}

export async function requireUserId(): Promise<string> {
  const userId = await getCurrentUserId();
  if (!userId) redirect(LOGIN_PATH);
  return userId;
}
