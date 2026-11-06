import { describe, expect, it } from "vitest";
import { supabaseUtcTimestamp } from "../../src/lib/supabase/timestamps";
describe("Supabase timestamp normalization", () => {
  it("preserves microseconds at a UTC preorder boundary", () => expect(supabaseUtcTimestamp("2026-11-03T00:21:52.219373+00:00")).toBe("2026-11-03T00:21:52.219373Z"));
  it("converts offset while preserving submillisecond precision", () => expect(supabaseUtcTimestamp("2026-11-03T07:21:52.219373+07:00")).toBe("2026-11-03T00:21:52.219373Z"));
  it("rejects invalid dates instead of inventing a boundary", () => expect(() => supabaseUtcTimestamp("invalid")).toThrow());
});
