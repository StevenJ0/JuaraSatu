import { z } from "zod";

const publicEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
});

export type PublicEnv = z.infer<typeof publicEnvSchema>;

export function parsePublicEnv(source: Record<string, string | undefined>): PublicEnv {
  const result = publicEnvSchema.safeParse(source);
  if (!result.success) {
    const invalidKeys = result.error.issues.map((issue) => issue.path.join(".")).join(", ");
    throw new Error(`Env publik tidak valid atau belum diisi: ${invalidKeys}`);
  }
  return result.data;
}

let cachedPublicEnv: PublicEnv | undefined;

export function getPublicEnv(): PublicEnv {
  // Next.js hanya meng-inline NEXT_PUBLIC_* ke bundle browser bila diakses secara literal,
  // jadi objek sumber dibentuk eksplisit, bukan dengan meneruskan `process.env` utuh.
  cachedPublicEnv ??= parsePublicEnv({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  });
  return cachedPublicEnv;
}
