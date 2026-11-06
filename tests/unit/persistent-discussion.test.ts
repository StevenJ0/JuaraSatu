import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
vi.mock("server-only", () => ({}));
import { buildBusinessContext } from "../../src/features/ai-context";
import { developmentEnabled, developmentProvider } from "../../src/features/campaign-strategist/development-provider";
import { sendPersistentDiscussion, discussionInputHash } from "../../src/features/campaign-strategist/persistent-discussion-service";
import { repositoryError } from "../../src/features/campaign-strategist/supabase-discussion-repository.server";
import { SupabaseError, supabaseTransport } from "../../src/lib/supabase/transport.server";
import { fakeDiscussionRepository } from "../fixtures/fake-discussion-repository";
import { freshContextInput, contextFixture } from "../fixtures/ai-context";
import type { SendDiscussion } from "../../src/features/campaign-strategist/persistence-contracts";

const environment = { NODE_ENV: "test", CAMPAIGN_DISCUSSION_PROVIDER: "fake", CAMPAIGN_DISCUSSION_CONTEXT: "seeded" };
function setup(failFinalize = false) {
  const built = buildBusinessContext(freshContextInput()); if (!built.success) throw new Error("Invalid fixture");
  const scope = { ...contextFixture.scope, ownerUserId: "11111111-1111-4111-8111-111111111111", sessionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa7" };
  const repository = fakeDiscussionRepository({ ownerUserId: scope.ownerUserId,
    session: { id: scope.sessionId, ...contextFixture.scope, version: 1, contextHash: built.data.contextHash, status: "active", messages: [] } }, failFinalize);
  const command: SendDiscussion = { sessionId: scope.sessionId, requestKey: "unit-request", expectedVersion: 1,
    expectedContextHash: built.data.contextHash, message: "Buat pengingat preorder.",
    preferences: { budgetCapIdr: 50000, allowDiscount: true, channels: ["whatsapp"] }, scenario: "normal" };
  const provider = developmentProvider("normal", environment); const generate = vi.spyOn(provider, "generate");
  const dependencies = { provider, loadContext: async () => freshContextInput(), now: () => contextFixture.calculatedAt };
  return { scope, repository, command, dependencies, generate };
}
describe("persistent discussion orchestration", () => {
  it("keeps the existing atomic discussion claim ahead of concurrent identical/conflicting inference", async () => {
    const f = setup(); let release: () => void = () => {}, enter: () => void = () => {};
    const gate = new Promise<void>(resolve => { release = resolve; }), entered = new Promise<void>(resolve => { enter = resolve; });
    f.generate.mockImplementation(async prompt => { enter(); await gate; return developmentProvider("normal", environment).generate(prompt); });
    const first = sendPersistentDiscussion(f.scope, f.command, f.repository, f.dependencies); await entered;
    try {
      expect(await sendPersistentDiscussion(f.scope, f.command, f.repository, f.dependencies)).toMatchObject({ success: true, status: "running" });
      expect(await sendPersistentDiscussion(f.scope, { ...f.command, message: "Different payload" }, f.repository, f.dependencies)).toMatchObject({ success: false, code: "IDEMPOTENCY_CONFLICT" });
      expect(f.generate).toHaveBeenCalledTimes(1);
    } finally { release(); await first; }
    expect(await sendPersistentDiscussion(f.scope, f.command, f.repository, f.dependencies)).toMatchObject({ success: true, status: "completed", replayed: true }); expect(f.generate).toHaveBeenCalledTimes(1);
  });
  it("runs C2 validation, commits before success, and replays without another provider call", async () => {
    const f = setup();
    const first = await sendPersistentDiscussion(f.scope, f.command, f.repository, f.dependencies);
    expect(first).toMatchObject({ success: true, status: "completed", persisted: true, replayed: false,
      proposal: { persistence: "saved", options: [{ assumedPromotionCostIdr: 10000, computedScenario: { hypotheticalFinalUnitPriceIdr: 120000 } }] } });
    const replay = await sendPersistentDiscussion(f.scope, f.command, f.repository, f.dependencies);
    expect(replay).toMatchObject({ success: true, status: "completed", replayed: true });
    expect(f.generate).toHaveBeenCalledTimes(1);
    expect(await f.repository.load(f.scope)).toMatchObject({ success: true, data: { version: 3, messages: [{ role: "user" }, { role: "assistant" }] } });
  });
  it("binds message, preferences, scenario and context to the request hash, excluding current version", () => {
    const f = setup();
    expect(discussionInputHash(f.command)).toBe(discussionInputHash({ ...f.command, expectedVersion: 9 }));
    expect(discussionInputHash(f.command)).not.toBe(discussionInputHash({ ...f.command, preferences: { ...f.command.preferences, budgetCapIdr: 20000 } }));
  });
  it("rejects a conflicting duplicate", async () => {
    const f = setup(); await sendPersistentDiscussion(f.scope, f.command, f.repository, f.dependencies);
    expect(await sendPersistentDiscussion(f.scope, { ...f.command, message: "Isi berbeda" }, f.repository, f.dependencies))
      .toEqual({ success: false, code: "IDEMPOTENCY_CONFLICT" });
  });
  it.each(["failure", "invalid"] as const)("records %s without a successful assistant", async (scenario) => {
    const f = setup(); f.dependencies.provider = developmentProvider(scenario, environment);
    const result = await sendPersistentDiscussion(f.scope, { ...f.command, scenario }, f.repository, f.dependencies);
    expect(result).toEqual({ success: false, code: scenario === "failure" ? "PROVIDER_TIMEOUT" : "INVALID_RESPONSE" });
    expect(await f.repository.load(f.scope)).toMatchObject({ success: true, data: { version: 3, messages: [{ role: "user" }] } });
  });
  it("does not claim success when finalization fails", async () => {
    const f = setup(true);
    expect(await sendPersistentDiscussion(f.scope, f.command, f.repository, f.dependencies)).toEqual({ success: false, code: "PERSISTENCE_UNAVAILABLE" });
    expect(await f.repository.load(f.scope)).toMatchObject({ success: true, data: { messages: [{ role: "user" }] } });
  });
  it("rejects changing business context after generation", async () => {
    const f = setup(); let calls = 0;
    f.dependencies.loadContext = async () => { const value = freshContextInput(); if (++calls > 1 && value.c1.status === "available") value.c1.data.product.variableCostIdr = 76000; return value; };
    expect(await sendPersistentDiscussion(f.scope, f.command, f.repository, f.dependencies)).toEqual({ success: false, code: "STALE_CONTEXT" });
  });
  it("revises discount, units and spending using bounded history", async () => {
    const f = setup(); await sendPersistentDiscussion(f.scope, f.command, f.repository, f.dependencies);
    f.dependencies.provider = developmentProvider("revision", environment);
    const revised = await sendPersistentDiscussion(f.scope, { ...f.command, requestKey: "revision", expectedVersion: 3,
      scenario: "revision", message: "Revisi diskon 5% unit 8 biaya 20000" }, f.repository, f.dependencies);
    expect(revised).toMatchObject({ success: true, proposal: { proposalVersion: 4, options: [{ offer: { discountBps: 500 }, assumedAdditionalUnits: 8, assumedPromotionCostIdr: 20000 }] } });
    expect(await f.repository.load(f.scope)).toMatchObject({ success: true, data: { version: 5, messages: [{ role: "user" }, { role: "assistant" }, { role: "user" }, { role: "assistant" }] } });
  });
  it("fails closed for fake configuration in production or without explicit opt-in", () => {
    expect(developmentEnabled({ ...environment, NODE_ENV: "production" })).toBe(false);
    expect(developmentEnabled({ NODE_ENV: "development" })).toBe(false);
    expect(() => developmentProvider("normal", { ...environment, NODE_ENV: "production" })).toThrow();
  });
  it("retains the previous normal-price choice when revising only units or budget", async () => {
    const f = setup(); await sendPersistentDiscussion(f.scope, f.command, f.repository, f.dependencies);
    f.dependencies.provider = developmentProvider("revision", environment);
    expect(await sendPersistentDiscussion(f.scope, { ...f.command, requestKey: "revise-budget", expectedVersion: 3,
      scenario: "revision", message: "Revisi unit 6 biaya 20000" }, f.repository, f.dependencies))
      .toMatchObject({ success: true, proposal: { options: [{ offer: { offerType: "normal_price", discountBps: 0 }, assumedAdditionalUnits: 6, assumedPromotionCostIdr: 20000 }] } });
  });
  it("provides only the latest contiguous bounded history to the provider", async () => {
    const f = setup(); const history = Array.from({ length: 24 }, (_, index) => ({ sequence: index + 1,
      role: index % 2 === 0 ? "user" as const : "assistant" as const, content: "Riwayat sintetis", contextHash: f.command.expectedContextHash }));
    const repository = fakeDiscussionRepository({ ownerUserId: f.scope.ownerUserId,
      session: { id: f.scope.sessionId, businessId: f.scope.businessId, preorderId: f.scope.preorderId, version: 1,
        contextHash: f.command.expectedContextHash, status: "active", messages: history } });
    expect(await sendPersistentDiscussion(f.scope, f.command, repository, f.dependencies)).toMatchObject({ success: true });
    const text: unknown = JSON.parse(f.generate.mock.calls[0][0].input);
    const parsed = z.object({ untrustedText: z.object({ history: z.array(z.object({ sequence: z.number() })) }) }).parse(text);
    expect(parsed.untrustedText.history).toHaveLength(20);
    expect(parsed.untrustedText.history.map((row) => row.sequence)).toEqual(Array.from({ length: 20 }, (_, index) => index + 5));
  });
  it("maps only known domain SQLSTATE messages to conflicts", () => {
    expect(repositoryError(new SupabaseError("40001", "VERSION_CONFLICT", 500))).toBe("VERSION_CONFLICT");
    expect(repositoryError(new SupabaseError("40001", "could not serialize access due to concurrent update", 500))).toBe("PERSISTENCE_UNAVAILABLE");
    expect(repositoryError(new SupabaseError("40001", "unrecognized custom conflict", 500))).toBe("PERSISTENCE_UNAVAILABLE");
  });
  it.each(["serialization", "domain", "transport"] as const)("uses bounded safe retry policy for %s errors", async (kind) => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321"); vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "synthetic-key");
    const fetchMock = vi.fn<typeof fetch>();
    if (kind === "transport") fetchMock.mockRejectedValueOnce(new Error("synthetic transport failure"));
    else fetchMock.mockResolvedValueOnce(Response.json({ code: "40001", message: kind === "serialization" ? "could not serialize access due to concurrent update" : "VERSION_CONFLICT" }, { status: 500 }));
    fetchMock.mockResolvedValue(Response.json(true)); vi.stubGlobal("fetch", fetchMock);
    try {
      const promise = supabaseTransport("synthetic-token").rpc("take_rate_limit", { p_key_hash: "a".repeat(64),
        p_window_start: "2026-11-03T00:00:00Z", p_expires_at: "2026-11-03T00:01:00Z", p_limit: 1 });
      if (kind === "serialization") { expect(await promise).toBe(true); expect(fetchMock).toHaveBeenCalledTimes(2); }
      else { await expect(promise).rejects.toBeInstanceOf(SupabaseError); expect(fetchMock).toHaveBeenCalledTimes(1); }
    } finally { vi.unstubAllGlobals(); vi.unstubAllEnvs(); }
  });
});
