import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { LOGIN_PATH } from "@/lib/supabase/proxy";

const EMAIL_OTP_TYPES: readonly EmailOtpType[] = ["signup", "invite", "magiclink", "recovery", "email_change", "email"];

function isEmailOtpType(value: string | null): value is EmailOtpType {
  return value !== null && EMAIL_OTP_TYPES.includes(value);
}

/**
 * Tujuan link konfirmasi email Supabase. Mendukung dua format:
 * - `?code=` (PKCE, template email bawaan Supabase)
 * - `?token_hash=&type=` (template email kustom yang direkomendasikan Supabase untuk SSR)
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");

  const supabase = await createSupabaseServerClient();
  let confirmed = false;

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    confirmed = !error;
  } else if (tokenHash && isEmailOtpType(type)) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    confirmed = !error;
  }

  const destination = request.nextUrl.clone();
  destination.search = "";
  destination.pathname = confirmed ? "/dashboard" : LOGIN_PATH;
  if (!confirmed) destination.searchParams.set("error", "confirm_failed");
  return NextResponse.redirect(destination);
}
