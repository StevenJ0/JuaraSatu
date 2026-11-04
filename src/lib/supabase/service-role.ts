import "server-only";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { getPublicEnv } from "@/lib/env";

/**
 * Client yang melewati RLS, hanya untuk operasi server tepercaya seperti checkout pembeli yang tidak punya akun.
 * Jangan dipakai untuk permintaan pemilik; mereka memakai client bersesi agar RLS tetap berlaku.
 */
export function createSupabaseServiceRoleClient() {
  const serviceRoleKey = z.string().min(1).parse(process.env.SUPABASE_SERVICE_ROLE_KEY);
  return createClient(getPublicEnv().NEXT_PUBLIC_SUPABASE_URL, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
