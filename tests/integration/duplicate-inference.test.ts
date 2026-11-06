import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { blueprintFixture } from "../fixtures/blueprint";
import { evaluationFixture, evaluationEnvironment } from "../fixtures/evaluation";
import { memoryClaimSetup } from "../fixtures/memory-claims";
import { generationClaimFixture } from "../fixtures/generation-claims";
import { blueprintWorkflow } from "../../src/features/campaign-blueprint/workflow.server";
import { generateBlueprint } from "../../src/features/campaign-blueprint/blueprint-service";
import { BlueprintPlanSchema, BlueprintRowSchema, type BlueprintRow, type CampaignRow } from "../../src/features/campaign-blueprint/contracts";
import { blueprintRepository } from "../../src/features/campaign-blueprint/repository.server";
import { evaluationRepository } from "../../src/features/campaign-evaluation/repository.server";
import { evaluationService } from "../../src/features/campaign-evaluation/service";
import { EvaluationRowSchema, type EvaluationRow } from "../../src/features/campaign-evaluation/contracts";
import { syntheticCampaignAnalytics, developmentEvaluationProvider } from "../../src/features/campaign-evaluation/development-provider";
import { calculateEvaluation } from "../../src/features/campaign-evaluation/calculate";
import { BlueprintError } from "../../src/features/campaign-blueprint/contracts";
import { EvaluationError } from "../../src/features/campaign-evaluation/contracts";

function barrier() {
  let calls = 0, enter: () => void = () => {}, twice: () => void = () => {}, release: () => void = () => {};
  const entered = new Promise<void>(resolve => { enter = resolve; });
  const duplicated = new Promise<void>(resolve => { twice = resolve; });
  const released = new Promise<void>(resolve => { release = resolve; });
  return { entered, duplicated, release, count: () => calls, async wait() { calls++; enter(); if (calls > 1) twice(); await released; } };
}

async function blueprintSetup(replan = false) {
  const f = await blueprintFixture(), b = barrier(); const original = await generateBlueprint(f.input, f.dependencies);
  const claims = generationClaimFixture(original.businessId, f.dependencies.now), rows: BlueprintRow[] = [];
  let campaign: CampaignRow = f.input.campaign;
  function saved(body: typeof original) {
    const row = BlueprintRowSchema.parse({ id: body.revision.requestId, business_id: body.businessId, campaign_id: body.campaignId,
      version: body.blueprintVersion, approval_status: "proposed", blueprint_json: body, source_ai_generation_id: body.source.generationId,
      context_hash: body.contextHash, approved_by_user_id: null, approved_at: null });
    rows.unshift(row); campaign = { ...campaign, version: campaign.version + 1, active_blueprint_id: row.id }; return row;
  }
  if (replan) saved(original);
  const scope = { businessId: original.businessId, ownerUserId: randomUUID() };
  const repository = { ...blueprintRepository(claims.user, () => claims.server, scope),
    generations: claims.instance(), selection: async () => f.input.selected,
    blueprint: async (id: string) => rows.find(row => row.id === id) ?? null,
    replay: async (id: string, _campaign: string, hash: string) => { const row = rows.find(row => row.id === id); if (row && row.blueprint_json.revision.requestHash !== hash) throw Error("IDEMPOTENCY_CONFLICT"); return row ?? null; },
    load: async () => ({ campaign, active: rows[0] ?? null, history: rows, materialized: { tasks: [], contents: [] } }),
    create: async (body: typeof original) => ({ row: rows.find(row => row.id === body.revision.requestId) ?? saved(body), replayed: false }),
    revise: async (body: typeof original) => ({ row: rows.find(row => row.id === body.revision.requestId) ?? saved(body), replayed: false }),
  };
  const provider = () => ({ async generate() { await b.wait(); return BlueprintPlanSchema.strip().parse(original); } });
  const deps = { loadContext: f.dependencies.loadContext, now: f.dependencies.now, provider, approvalEnabled: true };
  const selection = { sessionId: original.source.sessionId, generationId: original.source.generationId, proposalKey: original.source.proposalKey, proposalVersion: original.source.proposalVersion };
  const command = replan ? { ...f.input.command, requestId: randomUUID(), expectedCampaignVersion: 2, expectedBlueprintId: original.revision.requestId, expectedBlueprintVersion: 1 }
    : { selection, campaignId: original.campaignId, requestId: randomUUID() };
  const invoke = () => { const workflow = blueprintWorkflow({ ...repository, generations: claims.instance() }, deps); return replan ? workflow.revise(command) : workflow.create({ ...command, selection }); };
  return { b, invoke, rows, claims, f, repository, deps, command };
}

async function evaluationSetup() {
  const f = await evaluationFixture(), b = barrier(), rows: EvaluationRow[] = [], ownerUserId = randomUUID();
  const claims = generationClaimFixture(f.snapshot.campaign.business_id, () => f.now);
  const repo = { ...evaluationRepository(claims.user, () => claims.server, { businessId: f.snapshot.campaign.business_id, ownerUserId }), generations: claims.instance(),
    facts: async () => ({ snapshot: f.context.snapshot, costs: f.context.costs, costsCompleteness: f.context.costsCompleteness }),
    evaluation: async (id: string) => rows.find(row => row.id === id) ?? null,
    history: async () => ({ records: rows, unsupportedCount: 0 }), latestId: async () => rows[0]?.id ?? null,
    save: vi.fn<ReturnType<typeof evaluationRepository>["save"]>(async (id, metrics, analysis, latest) => {
      if ((rows[0]?.id ?? null) !== latest) throw Error("STALE_EVALUATION_VERSION");
      rows.unshift(EvaluationRowSchema.parse({ id, business_id: f.snapshot.campaign.business_id, campaign_id: f.snapshot.campaign.id,
        blueprint_id: f.snapshot.blueprint?.id, metrics_schema_version: 1, metrics_json: { ...metrics, cas: { expectedEvaluationId: latest } },
        analysis_json: analysis, limitations_json: f.context.limitations, evaluation_kind: "provisional", calculated_at: f.now, evaluated_at: f.now, source_ai_generation_id: null }));
      return null;
    }),
  };
  const narrative = await developmentEvaluationProvider("valid", evaluationEnvironment).generate({ summary: calculateEvaluation(f.context), references: f.context.references });
  const deps = { now: () => f.now, ownerUserId, enabled: true, databaseError(error: unknown): never { throw error; },
    analytics: async (facts: Awaited<ReturnType<typeof repo.facts>>, scenario: unknown, now: string) => syntheticCampaignAnalytics(facts.snapshot, scenario, now, evaluationEnvironment),
    provider: () => ({ async generate() { await b.wait(); return narrative; } }) };
  const command = { campaignId: f.snapshot.campaign.id, requestId: randomUUID(), expectedCampaignVersion: f.snapshot.campaign.version,
    expectedEvaluationId: null, expectedContextHash: f.context.contextHash, analyticsScenario: "exceeds_target", providerScenario: "valid" };
  const invoke = () => evaluationService({ ...repo, generations: claims.instance() }, deps).generate(command);
  return { b, rows, invoke, repo, claims, deps, command, f };
}

describe("F05 simultaneous real workflow/service boundaries, no live provider", () => {
  it.each([false, true])("Blueprint create/replan=%s: two independent coordinators invoke one provider", async replan => {
    const f = await blueprintSetup(replan), first = f.invoke(); await f.b.entered;
    const second = f.invoke(), observed = Promise.allSettled([first, second]);
    try {
      await Promise.race([second.catch(() => {}), f.b.duplicated]);
      expect(f.b.count()).toBe(1);
    } finally { f.b.release(); await observed; }
    expect((await observed)[1]).toMatchObject({ status: "rejected", reason: { code: "GENERATION_IN_PROGRESS", status: 409 } });
    expect(f.rows).toHaveLength(replan ? 2 : 1);
    expect((await f.invoke()).replayed).toBe(true); expect(f.b.count()).toBe(1);
  });
  it("Evaluation: concurrent duplicate cannot interpret twice; persisted result replays", async () => {
    const f = await evaluationSetup(), first = f.invoke(); await f.b.entered;
    const second = f.invoke(), observed = Promise.allSettled([first, second]);
    try { await Promise.race([second.catch(() => {}), f.b.duplicated]); expect(f.b.count()).toBe(1); }
    finally { f.b.release(); await observed; }
    expect((await observed)[1]).toMatchObject({ status: "rejected", reason: { code: "GENERATION_IN_PROGRESS" } });
    expect(f.rows).toHaveLength(1); expect((await f.invoke()).replayed).toBe(true); expect(f.b.count()).toBe(1);
  });
  it("Memory former database-contract blocker: durable canonical claim now limits inference to one", async () => {
    const f = await memoryClaimSetup(), b = barrier();
    f.generate.mockImplementation(async source => { await b.wait(); return f.output(source); });
    const first = f.invoke(); await b.entered;
    try { await expect(f.invoke()).rejects.toMatchObject({ code: "GENERATION_IN_PROGRESS" }); expect(b.count()).toBe(1); }
    finally { b.release(); await first; }
    expect(f.rows).toHaveLength(1); expect((await f.invoke()).replayed).toBe(true); expect(b.count()).toBe(1);
  });
  it("Blueprint rejects a simultaneous conflicting replan hash without a second inference", async () => {
    const f = await blueprintSetup(true), first = f.invoke(); await f.b.entered;
    try {
      const command = { ...f.f.input.command, requestId: f.command.requestId, expectedCampaignVersion: 2, expectedBlueprintId: f.rows[0].id, expectedBlueprintVersion: 1,
        edits: { ...f.f.input.command.edits, notes: "Different input" } };
      await expect(blueprintWorkflow(f.repository, f.deps).revise(command)).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
      expect(f.b.count()).toBe(1);
    } finally { f.b.release(); await first; }
  });
  it("Evaluation rejects a simultaneous conflicting payload without changing the first claim", async () => {
    const f = await evaluationSetup(), first = f.invoke(); await f.b.entered;
    try {
      await expect(evaluationService(f.repo, f.deps).generate({ ...f.command, providerScenario: "invalid" })).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
      expect(f.b.count()).toBe(1); expect(f.claims.rows[0].status).toBe("running");
    } finally { f.b.release(); await first; }
  });
  it("Blueprint recovers a successful generation after domain persistence failed without reinference", async () => {
    const f = await blueprintSetup(), save = f.repository.create; let attempts = 0; f.b.release();
    f.repository.create = async body => { if (++attempts === 1) throw new BlueprintError("PERSISTENCE_UNAVAILABLE", 503); return save(body); };
    await expect(f.invoke()).rejects.toMatchObject({ code: "PERSISTENCE_UNAVAILABLE" }); expect(f.rows).toHaveLength(0);
    expect(f.claims.rows[0].status).toBe("success");
    expect((await f.invoke()).active?.blueprint_json.provider).toBe("development-fake-blueprint"); expect(f.b.count()).toBe(1); expect(f.rows).toHaveLength(1);
  });
  it("Evaluation recovers checkpointed interpretation after persistence failed without reinference", async () => {
    const f = await evaluationSetup(); f.b.release(); f.repo.save.mockRejectedValueOnce(new EvaluationError("PERSISTENCE_UNAVAILABLE", 503));
    await expect(f.invoke()).rejects.toMatchObject({ code: "PERSISTENCE_UNAVAILABLE" }); expect(f.rows).toHaveLength(0);
    expect((await f.invoke()).history[0].row.analysis_json.status).toBe("available"); expect(f.b.count()).toBe(1); expect(f.rows).toHaveLength(1);
  });
  it.each(["failed", "invalid"] as const)("Evaluation %s generation stays a replayable failed result, not a successful narrative", async state => {
    const f = await evaluationSetup(); f.b.release(); f.deps.provider = () => ({ async generate() { await f.b.wait(); if (state === "failed") throw Error("Synthetic provider error"); return { summary: "Penjualan dijamin meningkat 999 unit" }; } });
    const result = await f.invoke(); expect(result.history[0].row.analysis_json.status).toBe(state);
    expect(f.claims.rows[0].status).toBe(state === "failed" ? "failed" : "invalid_output");
    expect((await f.invoke()).replayed).toBe(true); expect(f.b.count()).toBe(1);
  });
  it("does not save an Evaluation after its source changed while the provider was running", async () => {
    const f = await evaluationSetup(), first = f.invoke(), observed = first.catch(error => error); await f.b.entered;
    f.f.context.snapshot.tasks[0].version++; f.b.release();
    expect(await observed).toMatchObject({ code: "STALE_CONTEXT" }); expect(f.rows).toHaveLength(0);
    await expect(f.invoke()).rejects.toMatchObject({ code: "STALE_CONTEXT" }); expect(f.b.count()).toBe(1);
  });
});
