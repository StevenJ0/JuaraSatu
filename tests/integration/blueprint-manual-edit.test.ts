import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
vi.mock("server-only", () => ({}));
import { blueprintFixture } from "../fixtures/blueprint";
import { generateBlueprint } from "../../src/features/campaign-blueprint/blueprint-service";
import { blueprintWorkflow } from "../../src/features/campaign-blueprint/workflow.server";
import { blueprintRepository } from "../../src/features/campaign-blueprint/repository.server";
import { BlueprintRowSchema, BlueprintPlanSchema, CampaignBlueprintSchema, type BlueprintRow } from "../../src/features/campaign-blueprint/contracts";
import { configuredBlueprintProvider } from "../../src/features/campaign-blueprint/gemini.server";
import { SupabaseError, type SupabaseTransport } from "../../src/lib/supabase/transport.server";
import { generationClaimFixture } from "../fixtures/generation-claims";

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

async function setup() {
  const f = await blueprintFixture(), ownerUserId = randomUUID();
  const body = CampaignBlueprintSchema.parse({ ...await generateBlueprint(f.input, f.dependencies), provider: "gemini", model: "gemini-3.6-flash", providerRequestId: "original-recorded-fixture-id" });
  let campaign = { ...f.input.campaign, version: 2, active_blueprint_id: body.revision.requestId };
  const parent = BlueprintRowSchema.parse({ id: body.revision.requestId, business_id: body.businessId, campaign_id: body.campaignId, version: 1,
    approval_status: "proposed", blueprint_json: body, source_ai_generation_id: body.source.generationId, context_hash: body.contextHash,
    approved_by_user_id: null, approved_at: null });
  const rows = new Map<string, BlueprintRow>([[parent.id, structuredClone(parent)]]);
  let materialized = { tasks: [] as { id: string; task_key: string; completed_at: null }[], contents: [] as { id: string; content_key: string }[] };
  const select = vi.fn<SupabaseTransport["select"]>(async (table, query) => {
    if (query.business_id !== `eq.${body.businessId}`) return [];
    if (table === "campaigns") return query.id === `eq.${campaign.id}` ? [campaign] : [];
    if (table === "campaign_blueprints") return [...rows.values()].filter(row => (!query.id || query.id === `eq.${row.id}`) && (!query.campaign_id || query.campaign_id === `eq.${row.campaign_id}`)).sort((a, b) => b.version - a.version);
    if (table === "campaign_tasks") return materialized.tasks;
    if (table === "campaign_contents") return materialized.contents;
    if (table === "campaign_ai_sessions") return [{ id: body.source.sessionId, preorder_id: body.preorderId }];
    if (table === "ai_generations") return [{ id: body.source.generationId, session_id: body.source.sessionId, preorder_id: body.preorderId, status: "success", output_json: f.input.selected.proposal }];
    if (table === "campaign_ai_messages") return [{ id: body.source.messageId, session_id: body.source.sessionId, ai_generation_id: body.source.generationId, context_hash: body.contextHash, proposal_json: f.input.selected.proposal }];
    throw Error(`Unexpected read ${table}`);
  });
  const rpc = vi.fn<SupabaseTransport["rpc"]>(async (name, raw) => {
    if (name === "save_blueprint_revision") {
      const args = z.object({ p_blueprint_id: z.uuid(), p_expected_campaign_version: z.number(), p_blueprint_json: CampaignBlueprintSchema }).parse(raw);
      if (campaign.version !== args.p_expected_campaign_version) throw new SupabaseError("40001", "VERSION_CONFLICT", 409);
      const saved = BlueprintRowSchema.parse({ ...parent, id: args.p_blueprint_id, version: rows.size + 1, blueprint_json: args.p_blueprint_json });
      rows.set(saved.id, structuredClone(saved)); campaign = { ...campaign, version: campaign.version + 1, active_blueprint_id: saved.id }; return saved;
    }
    if (name === "approve_blueprint") {
      const args = z.object({ p_blueprint_id: z.uuid() }).parse(raw), row = rows.get(args.p_blueprint_id);
      if (!row) throw Error("Missing row");
      const saved: BlueprintRow = { ...row, approval_status: "approved", approved_by_user_id: ownerUserId, approved_at: f.dependencies.now() };
      rows.set(saved.id, saved); campaign = { ...campaign, version: campaign.version + 1 };
      materialized = { tasks: saved.blueprint_json.tasks.map(task => ({ id: randomUUID(), task_key: task.key, completed_at: null })),
        contents: saved.blueprint_json.contents.map(content => ({ id: randomUUID(), content_key: content.key })) };
      return saved;
    }
    throw Error(`Unexpected write ${name}`);
  });
  const user: SupabaseTransport = { select, rpc: vi.fn(), update: vi.fn(), insert: vi.fn() };
  const server: SupabaseTransport = { select: vi.fn(), rpc, update: vi.fn(), insert: vi.fn() };
  const privileged = vi.fn(() => server);
  const repository = { ...blueprintRepository(user, privileged, { businessId: body.businessId, ownerUserId }), generations: generationClaimFixture(body.businessId, f.dependencies.now).instance() };
  const wire = vi.fn<typeof fetch>(async () => Response.json({ status: "completed", steps: [{ type: "model_output", content: [{ type: "text", text: JSON.stringify(BlueprintPlanSchema.strip().parse(body)) }] }] }));
  vi.stubGlobal("fetch", wire);
  const provider = vi.fn(() => configuredBlueprintProvider("valid", { NODE_ENV: "test", CAMPAIGN_DISCUSSION_CONTEXT: "seeded", CAMPAIGN_DISCUSSION_PROVIDER: "gemini",
    CAMPAIGN_BLUEPRINT_PROVIDER: "gemini", GEMINI_API_KEY: "synthetic-no-network", GEMINI_MODEL: "gemini-3.6-flash" }));
  const dependencies = { loadContext: f.dependencies.loadContext, now: f.dependencies.now, approvalEnabled: true, provider };
  const workflow = blueprintWorkflow(repository, dependencies);
  const plan = BlueprintPlanSchema.strip().parse(body);
  plan.goal = "  Tujuan manual pemilik.\nPertahankan isi persis.  ";
  plan.contents[0].body = "  Caption manual pemilik.\nTinjau tautan preorder.  ";
  plan.rationale = "Rencana ini belum menjamin peningkatan penjualan.";
  const command = { ...f.input.command, requestId: randomUUID(), expectedCampaignVersion: 2, expectedBlueprintId: parent.id, expectedBlueprintVersion: 1,
    edits: { ...f.input.command.edits, plan } };
  return { ...f, body, parent, rows, repository, workflow, dependencies, provider, wire, rpc, privileged, select, command, plan,
    campaign: () => campaign, setCampaignVersion: (version: number) => { campaign = { ...campaign, version }; } };
}

describe("F07 manual revision through the actual workflow/repository with in-memory SQL transport", () => {
  it("preserves all accepted manual fields exactly on write and reload, with zero provider/SDK calls", async () => {
    const f = await setup(), original = structuredClone(f.parent);
    const result = await f.workflow.revise(f.command), active = result.active;
    expect(active?.blueprint_json.goal).toBe(f.plan.goal);
    expect(active?.blueprint_json.contents).toEqual(f.plan.contents);
    expect(active?.blueprint_json.rationale).toBe(f.plan.rationale);
    expect(active?.blueprint_json.provider).toBe("manual");
    expect(active?.blueprint_json).not.toHaveProperty("model"); expect(active?.blueprint_json).not.toHaveProperty("providerRequestId");
    expect((await f.repository.load(f.command.campaignId)).active?.blueprint_json).toEqual(active?.blueprint_json);
    expect(f.rows.get(f.parent.id)).toEqual(original);
    expect(active?.blueprint_json.source).toEqual(f.body.source);
    expect(f.provider).not.toHaveBeenCalled(); expect(f.wire).not.toHaveBeenCalled();
    expect(f.rpc).toHaveBeenCalledExactlyOnceWith("save_blueprint_revision", expect.objectContaining({ p_blueprint_json: expect.objectContaining({ provider: "manual", goal: f.plan.goal }) }));
  });
  it("does not require provider configuration for a manual edit", async () => {
    const f = await setup(); f.dependencies.provider.mockImplementation(() => { throw Error("No Gemini configuration"); });
    expect((await f.workflow.revise(f.command)).active?.blueprint_json.provider).toBe("manual");
    expect(f.provider).not.toHaveBeenCalled();
  });
  it("does not create duplicate revisions on exact replay and rejects payload conflicts", async () => {
    const f = await setup(); await f.workflow.revise(f.command);
    expect((await f.workflow.revise(f.command)).replayed).toBe(true); expect(f.rows.size).toBe(2); expect(f.rpc).toHaveBeenCalledTimes(1);
    await expect(f.workflow.revise({ ...f.command, edits: { ...f.command.edits, plan: { ...f.plan, goal: "Isi berbeda." } } })).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    expect(f.wire).not.toHaveBeenCalled();
  });
  it.each(["empty", "guarantee", "duplicate-task", "schedule", "cost", "capacity"])("rejects invalid manual %s without provider or persistence", async kind => {
    const f = await setup(), command = structuredClone(f.command);
    if (kind === "empty") command.edits.plan.goal = "  ";
    if (kind === "guarantee") command.edits.plan.goal = "Penjualan pasti meningkat.";
    if (kind === "duplicate-task") command.edits.plan.tasks.push(command.edits.plan.tasks[0]);
    if (kind === "schedule") command.edits.plan.tasks[0].dueAt = command.edits.endsAt;
    if (kind === "cost") { command.edits.discountBps = 9000; command.edits.marketingApproach = "limited_discount"; }
    if (kind === "capacity") command.edits.targetAdditionalUnits = 9;
    await expect(f.workflow.revise(command)).rejects.toThrow(); expect(f.rpc).not.toHaveBeenCalled(); expect(f.provider).not.toHaveBeenCalled(); expect(f.wire).not.toHaveBeenCalled();
  });
  it("rejects stale campaign, parent revision and source versions before write", async () => {
    const f = await setup(); f.setCampaignVersion(3);
    await expect(f.workflow.revise(f.command)).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    await expect(f.workflow.revise({ ...f.command, expectedBlueprintVersion: 99 })).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    const g = await setup(); g.dependencies.loadContext = async () => { const input = structuredClone(g.contextInput); if (input.c1.status === "available") input.c1.data.snapshot.productVersion++; return input; };
    const workflow = blueprintWorkflow(g.repository, g.dependencies);
    await expect(workflow.revise(g.command)).rejects.toMatchObject({ code: "STALE_CONTEXT" });
    expect(f.rpc).not.toHaveBeenCalled(); expect(g.rpc).not.toHaveBeenCalled(); expect(g.wire).not.toHaveBeenCalled();
  });
  it("rejects a different owner's Blueprint before privileged writes", async () => {
    const f = await setup(); const foreign = blueprintRepository({ select: f.select, rpc: vi.fn(), update: vi.fn(), insert: vi.fn() }, f.privileged,
      { businessId: randomUUID(), ownerUserId: randomUUID() });
    await expect(blueprintWorkflow(foreign, f.dependencies).revise(f.command)).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    expect(f.provider).not.toHaveBeenCalled(); expect(f.privileged).not.toHaveBeenCalled();
  });
  it("explicit replan invokes Gemini and persists validated backend financials", async () => {
    const f = await setup(), result = await f.workflow.revise({ ...f.command, edits: { ...f.command.edits, plan: undefined } });
    expect(f.provider).toHaveBeenCalledTimes(1); expect(f.wire).toHaveBeenCalledTimes(1);
    expect(result.active?.blueprint_json).toMatchObject({ provider: "gemini", model: "gemini-3.6-flash", providerRequestId: null, financial: f.body.financial });
    expect(result.active?.blueprint_json.goal).toBe(f.body.goal);
  });
  it("checks financial and context constraints again on manual approval", async () => {
    const f = await setup(), revised = await f.workflow.revise(f.command); if (!revised.active) throw Error("No revision");
    f.dependencies.loadContext = async () => { const input = structuredClone(f.contextInput); if (input.c1.status === "available") input.c1.data.snapshot.capacityVersion++; return input; };
    const workflow = blueprintWorkflow(f.repository, f.dependencies);
    await expect(workflow.approve({ campaignId: f.command.campaignId, blueprintId: revised.active.id, expectedBlueprintVersion: revised.active.version,
      expectedCampaignVersion: revised.campaign.version, confirm: true })).rejects.toMatchObject({ code: "STALE_CONTEXT" });
    expect(f.rpc.mock.calls.map(call => call[0])).toEqual(["save_blueprint_revision"]);
    expect(f.rows.get(revised.active.id)?.approval_status).toBe("proposed"); expect(f.provider).not.toHaveBeenCalled();
  });
  it("does not allow manual provenance to carry a new Gemini interaction or lack a parent", async () => {
    const f = await setup();
    const manual = { ...f.body, provider: "manual", model: undefined, providerRequestId: undefined,
      revision: { ...f.body.revision, parentBlueprintId: f.parent.id, parentVersion: f.parent.version } };
    expect(CampaignBlueprintSchema.safeParse(manual).success).toBe(true);
    expect(CampaignBlueprintSchema.safeParse({ ...manual, model: "gemini-3.6-flash", providerRequestId: null }).success).toBe(false);
    expect(CampaignBlueprintSchema.safeParse({ ...manual, revision: { ...manual.revision, parentBlueprintId: null } }).success).toBe(false);
  });
  it("failed or unsafe replan leaves the previous revision intact", async () => {
    const f = await setup(), prior = structuredClone(f.parent);
    f.wire.mockResolvedValue(Response.json({ status: "completed", steps: [{ type: "model_output", content: [{ type: "text", text: JSON.stringify({ ...BlueprintPlanSchema.strip().parse(f.body), rationale: "Dijamin laba Rp999999." }) }] }] }));
    await expect(f.workflow.revise({ ...f.command, edits: { ...f.command.edits, plan: undefined } })).rejects.toMatchObject({ code: "INVALID_CONTENT" });
    expect(f.rows.size).toBe(1); expect(f.rows.get(f.parent.id)).toEqual(prior); expect(f.rpc).not.toHaveBeenCalled();
  });
  it("manual revision still requires approval and uses the existing materialization RPC", async () => {
    const f = await setup(), revised = await f.workflow.revise(f.command); if (!revised.active) throw Error("No revision");
    expect(revised.active.approval_status).toBe("proposed"); expect(revised.materialized.tasks).toHaveLength(0);
    const approved = await f.workflow.approve({ campaignId: f.command.campaignId, blueprintId: revised.active.id, expectedBlueprintVersion: revised.active.version,
      expectedCampaignVersion: revised.campaign.version, confirm: true });
    expect(approved.active?.approval_status).toBe("approved"); expect(approved.materialized.tasks).toHaveLength(f.plan.tasks.length);
    expect(approved.materialized.contents).toHaveLength(f.plan.contents.length); expect(approved.campaign.status).toBe("draft");
    expect(f.rpc.mock.calls.map(call => call[0])).toEqual(["save_blueprint_revision", "approve_blueprint"]);
    expect(f.provider).not.toHaveBeenCalled(); expect(f.wire).not.toHaveBeenCalled();
  });
});
