import { describe, expect, it } from "vitest";
import { parsePublicEnv } from "@/lib/env";

describe("parsePublicEnv", () => {
  it("menerima env publik yang lengkap", () => {
    const env = parsePublicEnv({
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "publishable-key",
    });
    expect(env.NEXT_PUBLIC_SUPABASE_URL).toBe("https://example.supabase.co");
  });

  it("menolak env kosong dan menyebut key yang bermasalah", () => {
    expect(() => parsePublicEnv({ NEXT_PUBLIC_SUPABASE_URL: "bukan-url" })).toThrow(
      /NEXT_PUBLIC_SUPABASE_URL.*NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY/,
    );
  });
});
