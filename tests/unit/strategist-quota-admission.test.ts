import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createSupabaseDiscussionRepository } from "../../src/features/campaign-strategist/supabase-discussion-repository.server";
import { discussionApiError } from "../../src/features/campaign-strategist/discussion-api.server";
import type { SupabaseTransport } from "../../src/lib/supabase/transport.server";

afterEach(() => vi.unstubAllEnvs());
describe("Strategist quota admission boundary", () => {
  const scope = { businessId: randomUUID(), ownerUserId: randomUUID(), preorderId: randomUUID(), sessionId: randomUUID() };
  const command = { scope, expectedVersion: 1, contextHash: "a".repeat(64), requestKey: randomUUID(), inputHash: "b".repeat(64), message: "Mock only" };
  function setup(prior: unknown[] = []) {
    const user: SupabaseTransport = { select: vi.fn(async () => prior), rpc: vi.fn(async () => ({ status: "running", generationId: randomUUID() })),
      insert: vi.fn(async () => []), update: vi.fn(async () => []) };
    const server: SupabaseTransport = { ...user, rpc: vi.fn(async () => ({ status: "denied", window: "minute", retryAfter: 12 })) };
    const privileged = vi.fn(() => server);
    return { user, server, privileged, repository: createSupabaseDiscussionRepository(user, privileged, "mock-only") };
  }
  it("uses the owner-scoped atomic RPC and maps denial to HTTP 429 with Retry-After", async () => {
    vi.stubEnv("RATE_LIMIT_HMAC_KEY", "batch04b-test-only-hmac-secret-00000000");
    const f = setup(); let error: unknown;
    try { await f.repository.beginTurn(command); } catch (caught) { error = caught; }
    expect(error).toMatchObject({ code: "AI_RATE_LIMIT_EXCEEDED", status: 429, retryAfter: 12 });
    expect(f.server.rpc).toHaveBeenCalledWith("admit_ai_generation", expect.objectContaining({ p_business_id: scope.businessId,
      p_actor_user_id: scope.ownerUserId, p_session_id: scope.sessionId, p_daily_limit: 100 }));
    expect(f.user.rpc).not.toHaveBeenCalled();
    const response = discussionApiError(error);
    expect(response.status).toBe(429); expect(response.headers.get("Retry-After")).toBe("12");
    expect(await response.json()).toEqual({ success: false, code: "AI_RATE_LIMIT_EXCEEDED" });
  });
  it("replays an existing turn when the quota key is absent", async () => {
    vi.stubEnv("RATE_LIMIT_HMAC_KEY", undefined);
    const f = setup([{ id: randomUUID() }]);
    expect(await f.repository.beginTurn(command)).toMatchObject({ success: true, data: { status: "running" } });
    expect(f.user.rpc).toHaveBeenCalledWith("claim_ai_generation", expect.objectContaining({ p_actor_user_id: scope.ownerUserId }));
    expect(f.privileged).not.toHaveBeenCalled();
  });
  it("blocks a fresh turn without quota configuration", async () => {
    vi.stubEnv("RATE_LIMIT_HMAC_KEY", undefined);
    const f = setup();
    await expect(f.repository.beginTurn(command)).rejects.toMatchObject({ code: "AI_QUOTA_CONFIGURATION_REQUIRED", status: 503 });
    expect(f.privileged).not.toHaveBeenCalled();
  });
});
