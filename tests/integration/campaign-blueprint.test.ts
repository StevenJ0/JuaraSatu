import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { z } from "zod";
vi.mock("server-only", () => ({}));
import { supabaseTransport, privilegedTransport, type SupabaseTransport } from "../../src/lib/supabase/transport.server";
import { createSupabaseDiscussionRepository } from "../../src/features/campaign-strategist/supabase-discussion-repository.server";
import { sendPersistentDiscussion } from "../../src/features/campaign-strategist/persistent-discussion-service";
import { seededDevelopmentContext } from "../../src/features/campaign-strategist/development-context.server";
import { developmentProvider } from "../../src/features/campaign-strategist/development-provider";
import { buildBusinessContext } from "../../src/features/ai-context";
import { blueprintRepository } from "../../src/features/campaign-blueprint/repository.server";
import { blueprintWorkflow, editsFromBlueprint } from "../../src/features/campaign-blueprint/workflow.server";
import { developmentBlueprintProvider } from "../../src/features/campaign-blueprint/development-provider";
import { blueprintEnvironment } from "../fixtures/blueprint";
import { discussionFixtureScope } from "../fixtures/local-campaign.mjs";

let userA: SupabaseTransport; let userB: SupabaseTransport;
const scope = { ownerUserId: "11111111-1111-4111-8111-111111111111", businessId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1", preorderId: discussionFixtureScope().preorderId };
const prior = { url: process.env.NEXT_PUBLIC_SUPABASE_URL, key: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, secret: process.env.SUPABASE_SERVICE_ROLE_KEY };
beforeAll(async () => {
  const env = Object.fromEntries(readFileSync(".env.local", "utf8").split(/\r?\n/).map((line) => { const i = line.indexOf("="); return [line.slice(0, i), line.slice(i + 1)]; }));
  expect(env.NEXT_PUBLIC_SUPABASE_URL).toBe("http://127.0.0.1:54321");
  for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SERVICE_ROLE_KEY"]) process.env[key] = env[key];
  const accounts = z.array(z.object({ id: z.uuid(), email: z.email(), password: z.string() })).parse(JSON.parse(readFileSync("node_modules/.cache/database-v21-cutover/fixture-credentials.json", "utf8")));
  const clients: SupabaseTransport[] = [];
  for (const account of accounts) {
    const response = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, "Content-Type": "application/json" }, body: JSON.stringify({ email: account.email, password: account.password }) });
    expect(response.status).toBe(200); const login = z.object({ access_token: z.string(), user: z.object({ id: z.uuid() }) }).parse(await response.json());
    expect(login.user.id).toBe(account.id); clients.push(supabaseTransport(login.access_token));
  }
  [userA, userB] = clients;
});
afterAll(() => { for (const [key, value] of Object.entries({ NEXT_PUBLIC_SUPABASE_URL: prior.url, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: prior.key, SUPABASE_SERVICE_ROLE_KEY: prior.secret })) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
async function setup() {
  const now = () => new Date().toISOString(); const loadContext = seededDevelopmentContext(userA, blueprintEnvironment, now);
  const discussion = createSupabaseDiscussionRepository(userA, privilegedTransport, "development-fake"); const discussionScope = { ...scope, sessionId: randomUUID() };
  const context = buildBusinessContext(await loadContext(scope)); if (!context.success) throw new Error("Seed context unavailable");
  expect((await discussion.create(discussionScope, context.data.contextHash)).success).toBe(true);
  const key = `slice5-test-${randomUUID()}`;
  const result = await sendPersistentDiscussion(discussionScope, { sessionId: discussionScope.sessionId, expectedVersion: 1, expectedContextHash: context.data.contextHash,
    requestKey: key, message: "Pengingat untuk pengujian blueprint sintetis", preferences: { budgetCapIdr: 50000, allowDiscount: true, channels: ["whatsapp"] }, scenario: "normal" },
  discussion, { provider: developmentProvider("normal", blueprintEnvironment), now, loadContext });
  if (!result.success || result.status !== "completed") throw new Error("No persisted source proposal");
  const view = await discussion.view(discussionScope); if (!view.success) throw new Error("No discussion");
  const generation = view.data.generations.find((entry) => entry.request_key === key); if (!generation) throw new Error("No generation");
  const repository = blueprintRepository(userA, privilegedTransport, scope);
  const providerCalls = vi.fn((scenario: "valid" | "failure" | "invalid") => developmentBlueprintProvider(scenario, blueprintEnvironment));
  const workflow = blueprintWorkflow(repository, { loadContext, now, provider: providerCalls, approvalEnabled: true });
  const create = { selection: { sessionId: discussionScope.sessionId, generationId: generation.id, proposalVersion: result.proposal.proposalVersion, proposalKey: result.proposal.options[0].proposalKey },
    campaignId: randomUUID(), requestId: randomUUID(), scenario: "valid" as const };
  return { repository, workflow, create, providerCalls, context, loadContext, now };
}
describe("actual Supabase campaign blueprint workflow", () => {
  it("atomically creates sourced draft/blueprint, reloads, and reconciles duplicate creation", async () => {
    const f = await setup(); const created = await f.workflow.create(f.create);
    expect(created.campaign).toMatchObject({ status: "draft", published_at: null, version: 2 });
    expect(created.active).toMatchObject({ approval_status: "proposed", version: 1, source_ai_generation_id: f.create.selection.generationId });
    expect(created.materialized.tasks).toHaveLength(0); expect(created.materialized.contents).toHaveLength(0);
    expect((await f.workflow.create(f.create)).replayed).toBe(true); expect(f.providerCalls).toHaveBeenCalledTimes(1);
    await expect(f.workflow.create({ ...f.create, scenario: "invalid" })).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    expect((await f.repository.load(f.create.campaignId)).history).toHaveLength(1);
  });
  it("serializes concurrent duplicate creation without duplicate drafts or versions", async () => {
    const f = await setup(); await Promise.all([f.workflow.create(f.create), f.workflow.create(f.create)]);
    expect((await f.repository.load(f.create.campaignId)).history).toHaveLength(1);
  });
  it("revises, approves explicitly, replays approval, then invalidates approval on a new revision", async () => {
    const f = await setup(); let current = await f.workflow.create(f.create); if (!current.active) throw new Error("No blueprint");
    const edits = { ...editsFromBlueprint(current.active.blueprint_json), discountBps: 500, marketingApproach: "limited_discount", targetAdditionalUnits: 6, budgetCapIdr: 20000 };
    const revision = { campaignId: current.campaign.id, requestId: randomUUID(), expectedCampaignVersion: current.campaign.version,
      expectedBlueprintId: current.active.id, expectedBlueprintVersion: 1, edits, scenario: "valid" };
    current = await f.workflow.revise(revision); expect(current.active?.version).toBe(2); expect(current.active?.blueprint_json.financial.calculation.hypotheticalFinalUnitPriceIdr).toBe(114000);
    expect((await f.workflow.revise(revision)).replayed).toBe(true);
    await expect(f.workflow.revise({ ...revision, requestId: randomUUID() })).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    if (!current.active) throw new Error("No revision");
    const approval = { campaignId: current.campaign.id, blueprintId: current.active.id, expectedBlueprintVersion: 2, expectedCampaignVersion: current.campaign.version, confirm: true };
    const approved = await f.workflow.approve(approval);
    expect(approved.active).toMatchObject({ approval_status: "approved", approved_by_user_id: scope.ownerUserId }); expect(approved.active?.approved_at).not.toBeNull();
    expect(approved.materialized.tasks).toHaveLength(2); expect(approved.materialized.contents).toHaveLength(1);
    expect(approved.campaign.status).toBe("draft"); expect(approved.campaign.published_at).toBeNull(); expect(approved.campaign.discount_bps).toBe(500);
    const replay = await f.workflow.approve(approval); expect(replay.replayed).toBe(true); expect(replay.materialized.tasks).toHaveLength(2);
    await expect(f.workflow.approve({ ...approval, expectedBlueprintVersion: 1 })).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    if (!approved.active) throw new Error("No approved blueprint");
    const next = await f.workflow.revise({ ...revision, requestId: randomUUID(), expectedCampaignVersion: approved.campaign.version,
      expectedBlueprintId: approved.active.id, expectedBlueprintVersion: approved.active.version });
    expect(next.active).toMatchObject({ version: 3, approval_status: "proposed" }); expect(next.materialized.tasks).toHaveLength(0);
    expect(next.history.find((row) => row.id === approved.active?.id)?.approval_status).toBe("discarded");
    await expect(f.workflow.approve(approval)).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
  });
  it("rejects invalid/provider-failed revisions without changing the approved active version", async () => {
    const f = await setup(); const created = await f.workflow.create(f.create); if (!created.active) throw new Error("No blueprint");
    const approved = await f.workflow.approve({ campaignId: created.campaign.id, blueprintId: created.active.id, expectedBlueprintVersion: 1, expectedCampaignVersion: created.campaign.version, confirm: true });
    if (!approved.active) throw new Error("No active blueprint");
    const revision = { campaignId: approved.campaign.id, requestId: randomUUID(), expectedCampaignVersion: approved.campaign.version,
      expectedBlueprintId: approved.active.id, expectedBlueprintVersion: 1, edits: editsFromBlueprint(approved.active.blueprint_json), scenario: "failure" };
    await expect(f.workflow.revise(revision)).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
    await expect(f.workflow.revise({ ...revision, scenario: "invalid" })).rejects.toMatchObject({ code: "INVALID_BLUEPRINT" });
    await expect(f.workflow.revise({ ...revision, scenario: "valid", edits: { ...revision.edits, targetAdditionalUnits: 41 } })).rejects.toMatchObject({ code: "FINANCIAL_OR_CAPACITY_BLOCKER" });
    const loaded = await f.repository.load(approved.campaign.id); expect(loaded.history).toHaveLength(1); expect(loaded.active?.approval_status).toBe("approved");
  });
  it("denies foreign JWT access, source binding and direct atomic RPC execution", async () => {
    const f = await setup(); const other = blueprintRepository(userB, vi.fn(privilegedTransport), scope);
    await expect(other.selection(f.create.selection)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(f.workflow.create({ ...f.create, selection: { ...f.create.selection, proposalVersion: 999 } })).rejects.toMatchObject({ code: "INVALID_PROPOSAL" });
    const created = await f.workflow.create(f.create); await expect(other.load(created.campaign.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    if (!created.active) throw new Error("No blueprint");
    const body = created.active.blueprint_json;
    await expect(userA.rpc("create_campaign_with_initial_blueprint", { p_business_id: scope.businessId, p_preorder_id: scope.preorderId,
      p_campaign_id: randomUUID(), p_blueprint_id: randomUUID(), p_draft: {}, p_blueprint_json: body, p_context_hash: body.contextHash,
      p_source_generation_id: body.source.generationId, p_expected_source_versions: body.sourceVersions, p_actor_user_id: scope.ownerUserId })).rejects.toMatchObject({ code: "42501" });
  });
  it("rolls the new campaign back when initial child validation fails inside the same RPC", async () => {
    const f = await setup(); const created = await f.workflow.create(f.create); if (!created.active) throw new Error("No body");
    const id = randomUUID(); const bp = randomUUID();
    const body = structuredClone(created.active.blueprint_json); body.campaignId = id; body.revision.requestId = bp; body.tasks = [];
    await expect(privilegedTransport().rpc("create_campaign_with_initial_blueprint", { p_business_id: scope.businessId, p_preorder_id: scope.preorderId,
      p_campaign_id: id, p_blueprint_id: bp, p_blueprint_json: body, p_context_hash: body.contextHash, p_source_generation_id: body.source.generationId,
      p_expected_source_versions: body.sourceVersions, p_actor_user_id: scope.ownerUserId,
      p_draft: { name: body.campaignTitle, slug: `campaign-${id}`, offerType: body.offer.type, marketingApproach: body.marketingApproach,
        discountBps: body.offer.discountBps, budgetCapIdr: body.budgetCapIdr, targetAdditionalUnits: body.targetAdditionalUnits,
        startsAt: body.executionWindow.startsAt, endsAt: body.executionWindow.endsAt } })).rejects.toMatchObject({ code: "23514", detail: "BLUEPRINT_CONTENT_BOUNDS" });
    expect(await userA.select("campaigns", { select: "id", id: `eq.${id}` })).toEqual([]);
    expect(await userA.select("campaign_blueprints", { select: "id", id: `eq.${bp}` })).toEqual([]);
  });
  it("rolls approval flag, campaign projection, tasks and contents back together on a duplicate-content constraint", async () => {
    const f = await setup(); const created = await f.workflow.create(f.create); if (!created.active) throw new Error("No body");
    const invalid = structuredClone(created.active.blueprint_json); invalid.blueprintVersion = 2; invalid.revision.requestId = randomUUID(); invalid.contents.push(invalid.contents[0]);
    const literal = (value: unknown) => `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;
    const sql = `BEGIN; SET LOCAL search_path=public,extensions; SET LOCAL ROLE service_role; SET LOCAL request.jwt.claim.role='service_role';
      SELECT public.save_blueprint_revision('${scope.businessId}','${created.campaign.id}',${created.campaign.version},'${invalid.revision.requestId}','${invalid.contextHash}',${literal(invalid)},'${invalid.source.generationId}','${scope.ownerUserId}');
      DO $$ DECLARE ver integer; BEGIN SELECT version INTO ver FROM public.campaigns WHERE id='${created.campaign.id}';
       BEGIN PERFORM public.approve_blueprint('${scope.businessId}','${invalid.revision.requestId}',${literal({ ...invalid.sourceVersions, campaignVersion: created.campaign.version + 1 })},'${invalid.contextHash}','${scope.ownerUserId}');
        RAISE EXCEPTION 'EXPECTED_DUPLICATE_VIOLATION'; EXCEPTION WHEN unique_violation THEN NULL; END;
       IF (SELECT approval_status FROM public.campaign_blueprints WHERE id='${invalid.revision.requestId}')<>'proposed' OR
        EXISTS(SELECT 1 FROM public.campaign_tasks WHERE blueprint_id='${invalid.revision.requestId}') OR EXISTS(SELECT 1 FROM public.campaign_contents WHERE blueprint_id='${invalid.revision.requestId}') OR
        (SELECT version FROM public.campaigns WHERE id='${created.campaign.id}')<>ver THEN RAISE EXCEPTION 'PARTIAL_APPROVAL'; END IF;
      END $$; SELECT 'ROLLBACK_VERIFIED'; ROLLBACK;`;
    const output = execFileSync("docker", ["exec", "-i", "supabase_db_campaign-lab", "psql", "-U", "postgres", "-d", "postgres", "-X", "-qAt", "-v", "ON_ERROR_STOP=1"], { input: sql, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
    expect(output.includes("ROLLBACK_VERIFIED")).toBe(true);
    expect((await f.repository.load(created.campaign.id)).history).toHaveLength(1);
  });
  it("revalidates approval sources and fails safely when the source reader is unavailable or stale", async () => {
    const f = await setup(); const created = await f.workflow.create(f.create); if (!created.active) throw new Error("No body");
    const unavailable = blueprintWorkflow(f.repository, { loadContext: async () => { throw new Error("source unavailable"); }, now: f.now,
      provider: (scenario) => developmentBlueprintProvider(scenario, blueprintEnvironment), approvalEnabled: true });
    await expect(unavailable.approve({ campaignId: created.campaign.id, blueprintId: created.active.id, expectedBlueprintVersion: 1, expectedCampaignVersion: created.campaign.version, confirm: true })).rejects.toThrow();
    const stale = blueprintWorkflow(f.repository, { loadContext: async (scope) => { const raw = await f.loadContext(scope); if (raw.c1.status === "available") raw.c1.data.snapshot.productVersion++; return raw; },
      now: f.now, provider: (scenario) => developmentBlueprintProvider(scenario, blueprintEnvironment), approvalEnabled: true });
    await expect(stale.approve({ campaignId: created.campaign.id, blueprintId: created.active.id, expectedBlueprintVersion: 1, expectedCampaignVersion: created.campaign.version, confirm: true })).rejects.toMatchObject({ code: "STALE_CONTEXT" });
    expect((await f.repository.load(created.campaign.id)).active?.approval_status).toBe("proposed");
  });
});
