import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
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

export async function requireUserId(): Promise<string> {
  const userId = await getCurrentUserId();
  if (!userId) redirect(LOGIN_PATH);
  return userId;
}
