import { afterEach, describe, expect, it, vi } from "vitest";
import { localSupabaseConfig, SupabaseError } from "../../src/lib/supabase/transport.server";

afterEach(() => vi.unstubAllEnvs());

function configure(url: string | undefined, key: string | undefined = "test-publishable-key") {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", url);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", key);
  vi.stubEnv("NEXT_PUBLIC_PUBLISHABLE_KEY", undefined);
}

describe("local Supabase transport configuration", () => {
  it.each(["http://127.0.0.1:54321", "http://127.0.0.1:56321/"])("accepts configured loopback origin %s", (url) => {
    configure(url);
    expect(localSupabaseConfig()).toEqual({ url: new URL(url).origin, key: "test-publishable-key" });
  });

  it.each([
    undefined, "not-a-url", "http://127.0.0.1:99999", "https://127.0.0.1:56321", "ftp://127.0.0.1:56321",
    "http://remote.example:56321", "http://127.0.0.1.remote.example:56321", "http://127.0.0.2:56321",
    "http://user:password@127.0.0.1:56321", "http://127.0.0.1:56321/rest/v1", "http://127.0.0.1:56321/?query=1",
    "http://127.0.0.1:56321/#fragment",
  ])("rejects invalid or non-origin configuration %s with the existing typed error", (url) => {
    configure(url);
    expect(localSupabaseConfig).toThrow(SupabaseError);
    expect(localSupabaseConfig).toThrow(expect.objectContaining({ code: "CONFIGURATION_ERROR", detail: "LOCAL_ONLY", status: 503 }));
  });

  it("requires a publishable key", () => {
    configure("http://127.0.0.1:56321", undefined);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", undefined);
    expect(localSupabaseConfig).toThrow(SupabaseError);
  });

  it("preserves the existing alternate publishable-key name", () => {
    configure("http://127.0.0.1:54321");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", undefined);
    vi.stubEnv("NEXT_PUBLIC_PUBLISHABLE_KEY", "test-alternate-key");
    expect(localSupabaseConfig().key).toBe("test-alternate-key");
  });
});
