import { z } from "zod";

const emailSchema = z.string().trim().toLowerCase().pipe(z.email("Format email tidak valid"));

// Batas atas 72 mengikuti batas bcrypt yang dipakai Supabase Auth.
const passwordSchema = z
  .string()
  .min(8, "Password minimal 8 karakter")
  .max(72, "Password maksimal 72 karakter");

export const signInSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Password wajib diisi"),
});

const passwordsMatch = (input: { password: string; confirmPassword: string }) =>
  input.password === input.confirmPassword;
const PASSWORD_MISMATCH = { message: "Konfirmasi password tidak sama", path: ["confirmPassword"] };

export const signUpSchema = z
  .object({
    email: emailSchema,
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine(passwordsMatch, PASSWORD_MISMATCH);

export const emailRequestSchema = z.object({ email: emailSchema });

export const newPasswordSchema = z
  .object({
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine(passwordsMatch, PASSWORD_MISMATCH);

export type SignInInput = z.infer<typeof signInSchema>;
export type SignUpInput = z.infer<typeof signUpSchema>;
