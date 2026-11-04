"use server";

import { z } from "zod";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { LOGIN_PATH } from "@/lib/supabase/proxy";
import type { AuthError } from "@supabase/supabase-js";
import { readTextFields, type FormState } from "@/lib/form-state";
import { emailRequestSchema, newPasswordSchema, signInSchema, signUpSchema } from "@/features/auth/schemas";
import { toAuthErrorMessage } from "@/features/auth/errors";
import { getCurrentUserId } from "@/features/auth/session";
import { RECOVERY_FAILED_URL } from "@/features/auth/confirm-redirect";

const INVALID_REQUEST_MESSAGE = "Permintaan tidak valid. Muat ulang halaman lalu coba lagi.";

/** Tujuan link di email; harus terdaftar di Supabase Auth → URL Configuration → Redirect URLs. */
async function getConfirmUrl(): Promise<string | null> {
  const origin = (await headers()).get("origin");
  return origin ? `${origin}/auth/confirm` : null;
}

/**
 * Batas kirim per akun hanya muncul bila akunnya ada, jadi hasilnya disamakan dengan sukses
 * agar form email publik tidak bisa dipakai untuk mengecek email terdaftar.
 */
function toEmailRequestState(error: AuthError | null, email: string, successMessage: string): FormState {
  if (error) console.error("[auth] kirim email gagal", { code: error.code });
  if (error && error.code !== "over_email_send_rate_limit") {
    return { status: "error", message: toAuthErrorMessage(error.code), values: { email } };
  }
  return { status: "success", message: successMessage, values: { email } };
}

export async function signInAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const fields = readTextFields(formData, ["email", "password"]);
  const parsed = signInSchema.safeParse(fields);
  if (!parsed.success) {
    return {
      status: "error",
      fieldErrors: z.flattenError(parsed.error).fieldErrors,
      values: { email: fields.email },
    };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    return {
      status: "error",
      code: error.code,
      message: toAuthErrorMessage(error.code),
      values: { email: parsed.data.email },
    };
  }

  redirect("/dashboard");
}

export async function signUpAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const fields = readTextFields(formData, ["email", "password", "confirmPassword"]);
  const parsed = signUpSchema.safeParse(fields);
  if (!parsed.success) {
    return {
      status: "error",
      fieldErrors: z.flattenError(parsed.error).fieldErrors,
      values: { email: fields.email },
    };
  }

  const confirmUrl = await getConfirmUrl();
  if (!confirmUrl) return { status: "error", message: INVALID_REQUEST_MESSAGE };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: { emailRedirectTo: confirmUrl },
  });
  // Tergantung konfigurasi, Supabase menjawab email terdaftar dengan error atau respons sukses tanpa email.
  // Keduanya ditampilkan sama seperti pendaftaran baru agar form ini tidak bisa dipakai mengecek email terdaftar.
  const alreadyRegistered = error?.code === "user_already_exists" || error?.code === "email_exists";
  if (error && !alreadyRegistered) {
    return { status: "error", message: toAuthErrorMessage(error.code), values: { email: fields.email } };
  }

  // Session langsung ada hanya bila "Confirm email" dimatikan di Supabase; wajib menyala di semua environment.
  if (data.session) redirect("/onboarding");

  return {
    status: "success",
    message: `Buka link verifikasi yang kami kirim ke ${parsed.data.email} untuk mengaktifkan akun. Jika email ini sudah pernah terverifikasi, langsung masuk saja.`,
    values: { email: parsed.data.email },
  };
}

export async function resendConfirmationAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const parsed = emailRequestSchema.safeParse(readTextFields(formData, ["email"]));
  const confirmUrl = await getConfirmUrl();
  if (!parsed.success || !confirmUrl) return { status: "error", message: INVALID_REQUEST_MESSAGE };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.resend({
    type: "signup",
    email: parsed.data.email,
    options: { emailRedirectTo: confirmUrl },
  });
  return toEmailRequestState(
    error,
    parsed.data.email,
    "Jika akun ini belum terverifikasi, link baru sudah dikirim. Periksa folder spam. Bila belum ada, coba lagi beberapa menit lagi.",
  );
}

export async function requestPasswordResetAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const fields = readTextFields(formData, ["email"]);
  const parsed = emailRequestSchema.safeParse(fields);
  if (!parsed.success) {
    return {
      status: "error",
      fieldErrors: z.flattenError(parsed.error).fieldErrors,
      values: { email: fields.email },
    };
  }

  const confirmUrl = await getConfirmUrl();
  if (!confirmUrl) return { status: "error", message: INVALID_REQUEST_MESSAGE };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${confirmUrl}?type=recovery`,
  });
  return toEmailRequestState(
    error,
    parsed.data.email,
    "Jika email ini terdaftar, link untuk membuat password baru sudah dikirim. Periksa folder spam. Bila belum ada, coba lagi beberapa menit lagi.",
  );
}

export async function updatePasswordAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const parsed = newPasswordSchema.safeParse(readTextFields(formData, ["password", "confirmPassword"]));
  if (!parsed.success) {
    return { status: "error", fieldErrors: z.flattenError(parsed.error).fieldErrors };
  }

  // Link reset bisa kedaluwarsa selagi form terbuka.
  if (!(await getCurrentUserId())) redirect(RECOVERY_FAILED_URL);

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) return { status: "error", message: toAuthErrorMessage(error.code) };

  // Semua session diakhiri agar pihak lain yang masih masuk ikut keluar, dan password baru langsung terbukti saat login.
  await supabase.auth.signOut();
  redirect(`${LOGIN_PATH}?notice=password_updated`);
}

export async function signOutAction(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect(LOGIN_PATH);
}
