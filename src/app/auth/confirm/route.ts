import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { resolveConfirmRedirect } from "@/features/auth/confirm-redirect";

// Tanpa "recovery": fitur lupa password tidak ada, jadi link reset tidak diterima di sini.
const EMAIL_OTP_TYPES: readonly EmailOtpType[] = ["signup", "invite", "magiclink", "email_change", "email"];

function isEmailOtpType(value: string | null): value is EmailOtpType {
  return value !== null && EMAIL_OTP_TYPES.includes(value);
}

/**
 * Tujuan link verifikasi email Supabase. Mendukung dua format:
 * - `?code=` (PKCE, template email bawaan Supabase; hanya berhasil di browser yang memulai permintaan)
 * - `?token_hash=&type=` (template di `supabase/templates`; bisa dibuka di browser/perangkat lain)
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

  return NextResponse.redirect(new URL(resolveConfirmRedirect(confirmed), request.nextUrl));
}
