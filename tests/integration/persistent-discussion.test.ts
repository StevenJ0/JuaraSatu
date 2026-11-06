import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { z } from "zod";
vi.mock("server-only", () => ({}));
import { supabaseTransport, privilegedTransport, type SupabaseTransport } from "../../src/lib/supabase/transport.server";
import { createSupabaseDiscussionRepository } from "../../src/features/campaign-strategist/supabase-discussion-repository.server";
import { seededDevelopmentContext } from "../../src/features/campaign-strategist/development-context.server";
import { developmentProvider } from "../../src/features/campaign-strategist/development-provider";
import { sendPersistentDiscussion, discussionInputHash } from "../../src/features/campaign-strategist/persistent-discussion-service";
import { buildBusinessContext } from "../../src/features/ai-context";
import type { DiscussionScope } from "../../src/features/campaign-strategist/discussion-repository";
import type { SendDiscussion } from "../../src/features/campaign-strategist/persistence-contracts";
import { discussionFixtureScope } from "../fixtures/local-campaign.mjs";

const environment = { NODE_ENV: "test", CAMPAIGN_DISCUSSION_PROVIDER: "fake", CAMPAIGN_DISCUSSION_CONTEXT: "seeded" };
const ownerId = "11111111-1111-4111-8111-111111111111";
const businessId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const preorderId = discussionFixtureScope().preorderId;
let userA: SupabaseTransport; let userB: SupabaseTransport;
const original = { url: process.env.NEXT_PUBLIC_SUPABASE_URL, key: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, secret: process.env.SUPABASE_SERVICE_ROLE_KEY };
beforeAll(async () => {
  const env = new Map(readFileSync(".env.local", "utf8").split(/\r?\n/).flatMap((line) => {
    const index = line.indexOf("="); return index > 0 ? [[line.slice(0, index), line.slice(index + 1)]] : [];
  }));
  expect(env.get("NEXT_PUBLIC_SUPABASE_URL")).toBe("http://127.0.0.1:54321");
  process.env.NEXT_PUBLIC_SUPABASE_URL = env.get("NEXT_PUBLIC_SUPABASE_URL");
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = env.get("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  process.env.SUPABASE_SERVICE_ROLE_KEY = env.get("SUPABASE_SERVICE_ROLE_KEY");
  const accounts = z.array(z.object({ id: z.uuid(), email: z.email(), password: z.string() })).parse(
    JSON.parse(readFileSync("node_modules/.cache/database-v21-cutover/fixture-credentials.json", "utf8")));
  const clients: SupabaseTransport[] = [];
  for (const account of accounts) {
    const response = await fetch("http://127.0.0.1:54321/auth/v1/token?grant_type=password", { method: "POST",
      headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "", "Content-Type": "application/json" },
      body: JSON.stringify({ email: account.email, password: account.password }) });
    expect(response.status).toBe(200);
    const token = z.object({ access_token: z.string(), user: z.object({ id: z.uuid() }) }).parse(await response.json());
    expect(token.user.id).toBe(account.id); clients.push(supabaseTransport(token.access_token));
  }
  [userA, userB] = clients;
  const membership = z.array(z.object({ business_id: z.uuid() })).parse(await userA.select("business_members", { select: "business_id", user_id: `eq.${ownerId}` }));
  expect(membership).toEqual([{ business_id: businessId }]);
});
afterAll(() => {
  for (const [key, value] of Object.entries({ NEXT_PUBLIC_SUPABASE_URL: original.url, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: original.key, SUPABASE_SERVICE_ROLE_KEY: original.secret })) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});
async function setup() {
  const scope: DiscussionScope = { ownerUserId: ownerId, businessId, preorderId, sessionId: randomUUID() };
  const repository = createSupabaseDiscussionRepository(userA, privilegedTransport, "development-fake");
  const now = () => new Date().toISOString(); const loadContext = seededDevelopmentContext(userA, environment, now);
  const context = buildBusinessContext(await loadContext(scope)); if (!context.success) throw new Error("Local seeded context unavailable");
  expect((await repository.create(scope, context.data.contextHash)).success).toBe(true);
  const command: SendDiscussion = { sessionId: scope.sessionId, expectedVersion: 1, expectedContextHash: context.data.contextHash,
    requestKey: randomUUID(), message: "Pengingat preorder sintetis.", preferences: { budgetCapIdr: 50000, allowDiscount: true, channels: ["whatsapp"] }, scenario: "normal" };
  return { scope, repository, command, dependencies: { provider: developmentProvider("normal", environment), loadContext, now } };
}
describe("real local Supabase discussion repository and service", () => {
  it("persists/reloads/replays normal and revised strategies with real JWT and one provider call", async () => {
    const f = await setup(); const generate = vi.spyOn(f.dependencies.provider, "generate");
    const first = await sendPersistentDiscussion(f.scope, f.command, f.repository, f.dependencies);
    expect(first).toMatchObject({ success: true, persisted: true, status: "completed", proposal: { persistence: "saved" } });
    const reloaded = await createSupabaseDiscussionRepository(userA, privilegedTransport, "development-fake").view(f.scope);
    expect(reloaded).toMatchObject({ success: true, data: { version: 3, messages: [{ role: "user" }, { role: "assistant", proposal: { persistence: "saved" } }] } });
    expect(await sendPersistentDiscussion(f.scope, f.command, f.repository, f.dependencies)).toMatchObject({ success: true, replayed: true });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(await sendPersistentDiscussion(f.scope, { ...f.command, message: "Isi berbeda" }, f.repository, f.dependencies)).toEqual({ success: false, code: "IDEMPOTENCY_CONFLICT" });
    f.dependencies.provider = developmentProvider("revision", environment);
    expect(await sendPersistentDiscussion(f.scope, { ...f.command, requestKey: randomUUID(), expectedVersion: 3, scenario: "revision", message: "Revisi diskon 5% unit 8 biaya 20000" }, f.repository, f.dependencies))
      .toMatchObject({ success: true, proposal: { options: [{ offer: { discountBps: 500 }, assumedAdditionalUnits: 8, assumedPromotionCostIdr: 20000 }] } });
    expect(await f.repository.view(f.scope)).toMatchObject({ success: true, data: { version: 5, messages: [{ sequence: 1 }, { sequence: 2 }, { sequence: 3 }, { sequence: 4 }] } });
  });
  it.each(["failure", "invalid"] as const)("persists %s as failure, not assistant success, and permits an explicit new request", async (scenario) => {
    const f = await setup(); f.dependencies.provider = developmentProvider(scenario, environment);
    expect(await sendPersistentDiscussion(f.scope, { ...f.command, scenario }, f.repository, f.dependencies)).toEqual({ success: false, code: scenario === "failure" ? "PROVIDER_TIMEOUT" : "INVALID_RESPONSE" });
    expect(await f.repository.view(f.scope)).toMatchObject({ success: true, data: { version: 3, messages: [{ role: "user" }], generations: [{ status: "failed" }] } });
    f.dependencies.provider = developmentProvider("normal", environment);
    expect(await sendPersistentDiscussion(f.scope, { ...f.command, expectedVersion: 3, requestKey: randomUUID() }, f.repository, f.dependencies)).toMatchObject({ success: true, persisted: true });
  });
  it("enforces expected-version policy across two concurrent requests", async () => {
    const f = await setup();
    const results = await Promise.all([f.command, { ...f.command, requestKey: randomUUID(), message: "Permintaan bersamaan" }]
      .map((command) => sendPersistentDiscussion(f.scope, command, f.repository, f.dependencies)));
    expect(results.filter((value) => value.success)).toHaveLength(1);
    expect(results.filter((value) => !value.success)).toEqual([{ success: false, code: "VERSION_CONFLICT" }]);
    expect(await f.repository.view(f.scope)).toMatchObject({ success: true, data: { messages: [{ role: "user" }, { role: "assistant" }] } });
  });
  it("denies another JWT tenant before privileged finalization is even constructed", async () => {
    const f = await setup(); const generated = await sendPersistentDiscussion(f.scope, f.command, f.repository, f.dependencies);
    if (!generated.success || generated.status !== "completed") throw new Error("Expected stored proposal");
    const privileged = vi.fn(privilegedTransport);
    const foreign = createSupabaseDiscussionRepository(userB, privileged, "development-fake");
    expect(await foreign.load(f.scope)).toEqual({ success: false, code: "NOT_FOUND" });
    expect(await foreign.completeTurn({ scope: f.scope, generationId: randomUUID(), claimVersion: 2, proposal: generated.proposal })).toEqual({ success: false, code: "NOT_FOUND" });
    expect(privileged).not.toHaveBeenCalled();
  });
  it("reports persistence failure honestly when PostgreSQL denies the finalizer, leaving a recoverable running turn", async () => {
    const f = await setup(); const denied = createSupabaseDiscussionRepository(userA, () => userA, "development-fake");
    expect(await sendPersistentDiscussion(f.scope, f.command, denied, f.dependencies)).toEqual({ success: false, code: "PERSISTENCE_UNAVAILABLE" });
    const view = await f.repository.view(f.scope); if (!view.success) throw new Error("Missing session");
    expect(view.data.messages).toHaveLength(1); expect(view.data.generations[0].status).toBe("running");
    expect(await f.repository.failTurn({ scope: f.scope, generationId: view.data.generations[0].id, claimVersion: 2, errorCode: "PROVIDER_TIMEOUT" })).toMatchObject({ success: true });
  });
  it("preserves interrupted running requests and allows explicit CAS failure recovery", async () => {
    const f = await setup();
    const claim = await f.repository.beginTurn({ scope: f.scope, expectedVersion: 1, contextHash: f.command.expectedContextHash,
      requestKey: f.command.requestKey, inputHash: discussionInputHash(f.command), message: f.command.message });
    expect(claim).toMatchObject({ success: true, data: { status: "claimed" } });
    expect(await sendPersistentDiscussion(f.scope, f.command, f.repository, f.dependencies)).toMatchObject({ success: true, status: "running" });
    if (!claim.success || claim.data.status !== "claimed") throw new Error("Missing claim");
    expect(await f.repository.failTurn({ scope: f.scope, generationId: claim.data.generationId, claimVersion: claim.data.claimVersion, errorCode: "PROVIDER_TIMEOUT" })).toMatchObject({ success: true });
  });
  it("records stale context failure after the authorized synthetic source changes", async () => {
    const f = await setup(); const load = f.dependencies.loadContext; let calls = 0;
    f.dependencies.loadContext = async (scope) => { const value = await load(scope); if (++calls > 1 && value.c1.status === "available") {
      value.c1.data.product.variableCostIdr = 76000; value.c1.data.snapshot.productVersion++;
    } return value; };
    expect(await sendPersistentDiscussion(f.scope, f.command, f.repository, f.dependencies)).toEqual({ success: false, code: "STALE_CONTEXT" });
    expect(await f.repository.view(f.scope)).toMatchObject({ success: true, data: { messages: [{ role: "user" }], generations: [{ status: "failed", error_code: "STALE_CONTEXT" }] } });
  });
});
