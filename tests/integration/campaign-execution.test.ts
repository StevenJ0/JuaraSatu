import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { z } from "zod";
vi.mock("server-only", () => ({}));
import { supabaseTransport, privilegedTransport, type SupabaseTransport } from "../../src/lib/supabase/transport.server";
import { seededDevelopmentContext } from "../../src/features/campaign-strategist/development-context.server";
import { createSupabaseDiscussionRepository } from "../../src/features/campaign-strategist/supabase-discussion-repository.server";
import { sendPersistentDiscussion } from "../../src/features/campaign-strategist/persistent-discussion-service";
import { buildBusinessContext } from "../../src/features/ai-context";
import { developmentProvider } from "../../src/features/campaign-strategist/development-provider";
import { developmentBlueprintProvider } from "../../src/features/campaign-blueprint/development-provider";
import { blueprintRepository } from "../../src/features/campaign-blueprint/repository.server";
import { blueprintWorkflow } from "../../src/features/campaign-blueprint/workflow.server";
import { campaignExecutionService } from "../../src/features/campaign-execution/service";
import { executionRepository, executionDatabaseError } from "../../src/features/campaign-execution/repository.server";
import { readPublishedOffer } from "../../src/features/campaign-execution/published-offer.server";
import { blueprintEnvironment } from "../fixtures/blueprint";

let a: SupabaseTransport; let b: SupabaseTransport;
const FixtureSchema = z.object({ businessId: z.uuid(), ownerUserId: z.uuid(), preorderId: z.uuid(), productId: z.uuid(), capacityId: z.uuid() });
let scope: z.infer<typeof FixtureSchema>; const created = new Set<string>();
const saved = { NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY };
beforeAll(async () => {
  const env = Object.fromEntries(readFileSync(".env.local", "utf8").split(/\r?\n/).map((line) => { const i = line.indexOf("="); return [line.slice(0, i), line.slice(i + 1)]; }));
  expect(env.NEXT_PUBLIC_SUPABASE_URL).toBe("http://127.0.0.1:54321");
  for (const key of Object.keys(saved)) process.env[key] = env[key];
  const accounts = z.array(z.object({ id: z.uuid(), email: z.email(), password: z.string() })).parse(JSON.parse(readFileSync("node_modules/.cache/database-v21-cutover/fixture-credentials.json", "utf8")));
  const clients: SupabaseTransport[] = [];
  for (const account of accounts) {
    const response = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, "Content-Type": "application/json" }, body: JSON.stringify({ email: account.email, password: account.password }) });
    expect(response.status).toBe(200); clients.push(supabaseTransport(z.object({ access_token: z.string() }).parse(await response.json()).access_token));
  }
  [a, b] = clients; scope = z.array(FixtureSchema).length(2).parse(JSON.parse(readFileSync("node_modules/.cache/campaign-execution/scenarios.json", "utf8")))[0];
});
afterEach(async () => {
  for (const id of created) {
    const repo = executionRepository(a, privilegedTransport, scope); const c = await repo.campaign(id);
    if (c.status === "published") await repo.close(id, c.version);
  }
  created.clear();
});
afterAll(() => { for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
async function setup(discount = false, approve = true) {
  const now = () => new Date().toISOString(); const loadContext = seededDevelopmentContext(a, blueprintEnvironment, now);
  const context = buildBusinessContext(await loadContext(scope)); if (!context.success) throw new Error("No valid isolated context");
  const discussion = createSupabaseDiscussionRepository(a, privilegedTransport, "development-fake"); const session = { ...scope, sessionId: randomUUID() };
  expect((await discussion.create(session, context.data.contextHash)).success).toBe(true);
  const scenario = discount ? "discount" : "normal";
  const result = await sendPersistentDiscussion(session, { sessionId: session.sessionId, expectedVersion: 1, expectedContextHash: context.data.contextHash,
    requestKey: `slice6-test-${randomUUID()}`, message: discount ? "Usulkan diskon unit 6 biaya 25000" : "Pengingat unit 4 biaya 10000", preferences: { budgetCapIdr: 50000, allowDiscount: true, channels: ["whatsapp"] }, scenario },
  discussion, { now, loadContext, provider: developmentProvider(scenario, blueprintEnvironment) });
  if (!result.success || result.status !== "completed") throw new Error("No source strategy");
  const history = await discussion.view(session); if (!history.success) throw new Error("No history");
  const generation = history.data.generations[0]; if (!generation) throw new Error("No generation");
  const source = blueprintRepository(a, privilegedTransport, scope);
  const workflow = blueprintWorkflow(source, { now, loadContext, approvalEnabled: true, provider: (s) => developmentBlueprintProvider(s, blueprintEnvironment) });
  let view = await workflow.create({ campaignId: randomUUID(), requestId: randomUUID(), scenario: "valid", selection: {
    sessionId: session.sessionId, generationId: generation.id, proposalVersion: result.proposal.proposalVersion, proposalKey: result.proposal.options[0].proposalKey } });
  created.add(view.campaign.id); if (!view.active) throw new Error("No blueprint");
  if (approve) view = await workflow.approve({ campaignId: view.campaign.id, blueprintId: view.active.id, expectedBlueprintVersion: 1, expectedCampaignVersion: view.campaign.version, confirm: true });
  if (!view.active) throw new Error("No approved blueprint");
  const repo = executionRepository(a, privilegedTransport, scope);
  const dependencies = { now, loadContext, publishingEnabled: true, selection: source.selection, databaseError: executionDatabaseError };
  return { repo, service: campaignExecutionService(repo, dependencies), dependencies, now, view,
    command: { campaignId: view.campaign.id, blueprintId: view.active.id, expectedBlueprintVersion: 1, expectedCampaignVersion: view.campaign.version, expectedContextHash: view.active.context_hash, confirm: true } };
}
describe("actual Supabase publishing, execution and lifecycle", () => {
  it.each([false, true])("publishes with real provenance, baseline, C3 and idempotent reconnect: discount=%s", async (discount) => {
    const f = await setup(discount); const published = await f.service.publish(f.command);
    expect(published.campaign).toMatchObject({ status: "published", published_blueprint_id: f.command.blueprintId, metrics_schema_version: 1, completed_at: null });
    expect(published.campaign.baseline_json).toMatchObject({ baseline_preorder_paid_units: 0, sourceVersions: { campaignVersion: f.command.expectedCampaignVersion } });
    expect(published.campaign.baseline_calculated_at).not.toBeNull();
    expect(published.c3).toMatchObject({ state: "active", eligible: true, configuration: { unitPriceIdr: discount ? 108000 : 120000 } });
    expect((await f.service.publish(f.command)).replayed).toBe(true);
    const reconnected = executionRepository(a, privilegedTransport, scope); expect((await readPublishedOffer(reconnected, scope, f.now())).state).toBe("active");
    expect((await reconnected.load(published.campaign.id)).tasks).toHaveLength(2);
    expect(await a.select("orders", { select: "id", preorder_id: `eq.${scope.preorderId}` })).toEqual([]);
  });
  it("reconciles concurrent identical publication and persists one baseline/version transition", async () => {
    const f = await setup(); const results = await Promise.all([f.service.publish(f.command), f.service.publish(f.command)]);
    expect(results.every((result) => result.campaign.status === "published")).toBe(true);
    expect((await f.repo.campaign(f.command.campaignId)).version).toBe(f.command.expectedCampaignVersion + 1);
  });
  it("serializes competing campaigns for one preorder and rolls back the rejected publication", async () => {
    const first = await setup(); const second = await setup(true);
    const results = await Promise.allSettled([first.service.publish(first.command), second.service.publish(second.command)]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected"); expect(rejected?.status === "rejected" ? rejected.reason : null).toMatchObject({ code: "CAMPAIGN_CONFLICT" });
    const rows = await Promise.all([first.repo.campaign(first.command.campaignId), second.repo.campaign(second.command.campaignId)]);
    expect(rows.filter((row) => row.status === "published")).toHaveLength(1);
    expect(rows.find((row) => row.status === "draft")).toMatchObject({ published_at: null, published_blueprint_id: null, baseline_json: null });
  });
  it("rejects unapproved, wrong-version and stale hash publication without partial writes", async () => {
    const proposed = await setup(false, false);
    await expect(proposed.service.publish(proposed.command)).rejects.toMatchObject({ code: "BLUEPRINT_NOT_APPROVED" });
    const f = await setup();
    await expect(f.service.publish({ ...f.command, expectedBlueprintVersion: 2 })).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    await expect(f.service.publish({ ...f.command, expectedContextHash: "0".repeat(64) })).rejects.toMatchObject({ code: "STALE_CONTEXT" });
    expect(await f.repo.campaign(f.command.campaignId)).toMatchObject({ status: "draft", published_at: null, baseline_json: null });
  });
  it("persists concurrent duplicate checklist updates and reopen CAS without timestamp/version corruption", async () => {
    const f = await setup(); const published = await f.service.publish(f.command); const task = published.tasks[0];
    const command = { campaignId: published.campaign.id, blueprintId: task.blueprint_id, taskId: task.id, expectedTaskVersion: task.version, completed: true };
    const results = await Promise.all([f.service.task(command), f.service.task(command)]);
    expect(results.every((result) => result.calendar.progress.completed === 1)).toBe(true);
    let view = await f.service.view(published.campaign.id); expect(view.tasks[0].version).toBe(task.version + 1); const at = view.tasks[0].completed_at;
    await f.service.task(command); expect((await f.repo.load(view.campaign.id)).tasks[0].completed_at).toBe(at);
    view = await f.service.task({ ...command, expectedTaskVersion: task.version + 1, completed: false }); expect(view.tasks[0].completed_at).toBeNull(); expect(view.calendar.progress.completed).toBe(0);
    await expect(f.service.task(command)).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    expect(view.campaign.version).toBe(published.campaign.version);
  });
  it("closes atomically with duplicate/concurrent reconciliation, keeps plan/history and makes C3 ineligible", async () => {
    const f = await setup(); const published = await f.service.publish(f.command);
    const close = { campaignId: published.campaign.id, expectedCampaignVersion: published.campaign.version, confirm: true };
    const closed = await Promise.all([f.service.close(close), f.service.close(close)]);
    expect(closed.every((result) => result.campaign.status === "closed")).toBe(true);
    const loaded = await f.service.view(published.campaign.id); expect(loaded.campaign).toMatchObject({ status: "closed", completed_at: null });
    expect(loaded.tasks).toHaveLength(2); expect(loaded.contents).toHaveLength(1); expect(loaded.c3).toMatchObject({ state: "closed", eligible: false });
    expect((await readPublishedOffer(f.repo, scope, f.now())).state).toBe("closed");
    const task = loaded.tasks[0]; expect((await f.service.task({ campaignId: loaded.campaign.id, blueprintId: task.blueprint_id, taskId: task.id, expectedTaskVersion: task.version, completed: true })).calendar.progress.completed).toBe(1);
    expect(await a.select("campaign_evaluations", { select: "id", campaign_id: `eq.${loaded.campaign.id}` })).toEqual([]);
  });
  it("uses real JWTs to deny cross-tenant publication, task writes, close and execution reads", async () => {
    const f = await setup(); const foreign = executionRepository(b, privilegedTransport, scope);
    const service = campaignExecutionService(foreign, f.dependencies);
    await expect(service.publish(f.command)).rejects.toMatchObject({ code: "NOT_FOUND" });
    const published = await f.service.publish(f.command); const task = published.tasks[0];
    await expect(foreign.load(published.campaign.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(service.task({ campaignId: published.campaign.id, blueprintId: task.blueprint_id, taskId: task.id, expectedTaskVersion: task.version, completed: true })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(foreign.close(published.campaign.id, published.campaign.version)).rejects.toMatchObject({ code: "42501" });
    await expect(b.update("campaign_tasks", { id: `eq.${task.id}` }, { completed_at: f.now() })).rejects.toMatchObject({ code: "42501" });
    await expect(a.rpc("publish_campaign", { p_business_id: scope.businessId, p_campaign_id: published.campaign.id, p_expected_versions: {}, p_actor_user_id: scope.ownerUserId })).rejects.toMatchObject({ code: "42501" });
  });
  it("rejects changed PostgreSQL source versions at the atomic publish boundary without a baseline", async () => {
    const f = await setup(); const snapshot = await f.repo.load(f.command.campaignId);
    const sql = `BEGIN; SET LOCAL ROLE service_role; SET LOCAL request.jwt.claim.role='service_role';
      UPDATE public.products SET base_price_idr=130000 WHERE id='${scope.productId}';
      DO $$ BEGIN BEGIN PERFORM public.publish_campaign('${scope.businessId}','${snapshot.campaign.id}','${JSON.stringify({ ...snapshot.blueprint?.blueprint_json.sourceVersions, campaignVersion: snapshot.campaign.version })}'::jsonb,'${scope.ownerUserId}');
        RAISE EXCEPTION 'EXPECTED_STALE'; EXCEPTION WHEN serialization_failure THEN IF SQLERRM<>'STALE_FACT_VERSIONS' THEN RAISE; END IF; END;
        IF (SELECT published_at IS NOT NULL OR baseline_json IS NOT NULL FROM public.campaigns WHERE id='${snapshot.campaign.id}') THEN RAISE EXCEPTION 'PARTIAL_PUBLICATION'; END IF;
      END $$; SELECT 'STALE_ROLLBACK_VERIFIED'; ROLLBACK;`;
    const result = execFileSync("docker", ["exec", "-i", "supabase_db_campaign-lab", "psql", "-U", "postgres", "-d", "postgres", "-X", "-qAt", "-v", "ON_ERROR_STOP=1"], { input: sql, encoding: "utf8", stdio: "pipe" });
    expect(result).toContain("STALE_ROLLBACK_VERIFIED"); expect((await f.repo.campaign(snapshot.campaign.id)).status).toBe("draft");
  });
});
