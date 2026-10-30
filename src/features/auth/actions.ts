"use server";

import { z } from "zod";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { LOGIN_PATH } from "@/lib/supabase/proxy";
import { readTextFields, type FormState } from "@/lib/form-state";
import { signInSchema, signUpSchema } from "@/features/auth/schemas";
import { toAuthErrorMessage } from "@/features/auth/errors";

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
    return { status: "error", message: toAuthErrorMessage(error.code), values: { email: fields.email } };
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

  const origin = (await headers()).get("origin");
  if (!origin) {
    return { status: "error", message: "Permintaan tidak valid. Muat ulang halaman lalu coba lagi." };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    // URL ini harus terdaftar di Supabase Auth → URL Configuration → Redirect URLs.
    options: { emailRedirectTo: `${origin}/auth/confirm` },
  });
  if (error) {
    return { status: "error", message: toAuthErrorMessage(error.code), values: { email: fields.email } };
  }

  // Jika konfirmasi email dimatikan di Supabase, session langsung tersedia.
  if (data.session) redirect("/onboarding");

  return {
    status: "success",
    message: "Pendaftaran berhasil. Buka link konfirmasi yang kami kirim ke email Anda, lalu masuk.",
  };
}

export async function signOutAction(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect(LOGIN_PATH);
}
