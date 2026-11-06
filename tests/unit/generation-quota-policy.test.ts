import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { generationQuotaPolicy } from "../../src/lib/ai/generation-quota-policy.server";
const env = { RATE_LIMIT_HMAC_KEY: "batch04-synthetic-server-secret-not-a-real-key" };
const business = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
function policy(limit?: string) {
  const result = generationQuotaPolicy({ ...env, ...(limit === undefined ? {} : { AI_DAILY_GENERATION_LIMIT: limit }) });
  if (!result.success) throw Error(result.code); return result;
}
describe("independent quota policy; not a durable admission implementation", () => {
  it("uses the PRD starter daily cap100 and fixed6/minute,30/hour", () => {
    const result = policy(); expect(result.dailyLimit).toBe(100); expect(result.timezone).toBe("Asia/Jakarta");
    expect(result.windows(business, "2026-11-06T03:04:05Z").map(window => [window.kind, window.limit])).toEqual([["minute", 6], ["hour", 30], ["day", 100]]);
  });
  it.each(["1", "35", "2147483647"])("accepts positive bounded daily cap%s", limit => { expect(policy(limit).dailyLimit).toBe(Number(limit)); });
  it.each(["", "0", "-1", "1.5", "NaN", "Infinity", "1e2", "01", " 10 ", "2147483648", "999999999999"])("fails safely for daily config%s", value => {
    expect(generationQuotaPolicy({ ...env, AI_DAILY_GENERATION_LIMIT: value })).toEqual({ success: false, code: "AI_QUOTA_CONFIGURATION_REQUIRED" });
  });
  it.each([undefined, "", "short", " ".repeat(32)])("fails closed without a usable HMAC secret%#", secret => {
    expect(generationQuotaPolicy({ RATE_LIMIT_HMAC_KEY: secret })).toEqual({ success: false, code: "AI_QUOTA_CONFIGURATION_REQUIRED" });
  });
  it("uses the same business keys across modules, sessions, tabs and request IDs", () => {
    const result = policy(), expected = result.windows(business, "2026-11-06T03:04:05Z");
    for (const operation of ["strategist", "blueprint", "evaluation", "memory"]) expect(result.windows(business, "2026-11-06T03:04:05Z"), operation).toEqual(expected);
    expect(result.windows(business.toUpperCase(), "2026-11-06T03:04:05Z")).toEqual(expected);
    expect(new Set(expected.map(window => window.keyHash)).size).toBe(3);
    expect(expected.every(window => /^[a-f0-9]{64}$/.test(window.keyHash))).toBe(true);
  });
  it("keeps businesses and HMAC namespaces isolated without returning the secret", () => {
    const result = policy(), own = result.windows(business, "2026-11-06T03:04:05Z"), foreign = result.windows(randomUUID(), "2026-11-06T03:04:05Z");
    expect(own.every((window, index) => window.keyHash !== foreign[index].keyHash)).toBe(true);
    expect(JSON.stringify(result)).not.toContain(env.RATE_LIMIT_HMAC_KEY); expect(JSON.stringify(own)).not.toContain(business);
    const changed = generationQuotaPolicy({ RATE_LIMIT_HMAC_KEY: "batch04-another-synthetic-secret-at-least32" }); if (!changed.success) throw Error(changed.code);
    expect(changed.windows(business, "2026-11-06T03:04:05Z")[0].keyHash).not.toBe(own[0].keyHash);
  });
  it("uses half-open minute/hour boundaries and a midnight WIB daily reset", () => {
    const result = policy(), before = result.windows(business, "2026-11-06T16:59:59.999Z"), after = result.windows(business, "2026-11-06T17:00:00Z");
    expect(before.map(window => window.expiresAt)).toEqual(["2026-11-06T17:00:00.000Z", "2026-11-06T17:00:00.000Z", "2026-11-06T17:00:00.000Z"]);
    expect(after.map(window => window.windowStart)).toEqual(before.map(window => window.expiresAt));
    expect(before[2].windowStart).toBe("2026-11-05T17:00:00.000Z"); expect(after[2].expiresAt).toBe("2026-11-07T17:00:00.000Z");
    expect(after.map(window => window.keyHash)).toEqual(before.map(window => window.keyHash));
  });
  it("normalizes equivalent offset timestamps and rejects malformed identity/time", () => {
    const result = policy(); expect(result.windows(business, "2026-11-06T10:04:05+07:00")).toEqual(result.windows(business, "2026-11-06T03:04:05Z"));
    expect(() => result.windows("foreign-client-input", "2026-11-06T03:04:05Z")).toThrow(); expect(() => result.windows(business, "invalid-time")).toThrow();
  });
});
