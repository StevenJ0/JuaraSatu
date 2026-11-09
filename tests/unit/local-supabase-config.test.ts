import { afterEach, describe, expect, it, vi } from "vitest";
import { supabaseRestConfig, SupabaseError } from "../../src/lib/supabase/transport.server";

afterEach(() => vi.unstubAllEnvs());

function configure(url: string | undefined, key: string | undefined = "test-publishable-key") {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", url);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", key);
  vi.stubEnv("NEXT_PUBLIC_PUBLISHABLE_KEY", undefined);
}

describe("Supabase REST transport configuration", () => {
  it.each([
    "http://127.0.0.1:54321", "http://127.0.0.1:56321/", "http://localhost:54321",
    "https://abcdefghijklmnop.supabase.co", "https://127.0.0.1:56321",
  ])("accepts a loopback or HTTPS origin %s", (url) => {
    configure(url);
    expect(supabaseRestConfig()).toEqual({ url: new URL(url).origin, key: "test-publishable-key" });
  });

  it.each([
    undefined, "not-a-url", "http://127.0.0.1:99999", "ftp://127.0.0.1:56321",
    "http://remote.example:56321", "http://127.0.0.1.remote.example:56321", "http://127.0.0.2:56321",
    "http://abcdefghijklmnop.supabase.co", "https://user:password@abcdefghijklmnop.supabase.co",
    "http://user:password@127.0.0.1:56321", "http://127.0.0.1:56321/rest/v1", "http://127.0.0.1:56321/?query=1",
    "http://127.0.0.1:56321/#fragment", "https://abcdefghijklmnop.supabase.co/rest/v1",
  ])("rejects plain remote HTTP or non-origin configuration %s with the existing typed error", (url) => {
    configure(url);
    expect(supabaseRestConfig).toThrow(SupabaseError);
    expect(supabaseRestConfig).toThrow(expect.objectContaining({ code: "CONFIGURATION_ERROR", detail: "INVALID_SUPABASE_URL", status: 503 }));
  });

  it("requires a publishable key", () => {
    configure("http://127.0.0.1:56321", undefined);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", undefined);
    expect(supabaseRestConfig).toThrow(SupabaseError);
  });

  it("preserves the existing alternate publishable-key name", () => {
    configure("http://127.0.0.1:54321");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", undefined);
    vi.stubEnv("NEXT_PUBLIC_PUBLISHABLE_KEY", "test-alternate-key");
    expect(supabaseRestConfig().key).toBe("test-alternate-key");
  });
});
