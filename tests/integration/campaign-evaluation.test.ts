import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { z } from "zod";
vi.mock("server-only", () => ({}));
import { fixtureTokens, call } from "../fixtures/local-campaign.mjs";
import { createEvaluationFixture } from "../fixtures/local-evaluation.mjs";
import { supabaseTransport, privilegedTransport, type SupabaseTransport } from "../../src/lib/supabase/transport.server";
import { ExecutionViewSchema } from "../../src/features/campaign-execution/contracts";
import { evaluationRepository, evaluationDatabaseError } from "../../src/features/campaign-evaluation/repository.server";
import { evaluationService, evaluationHandoff } from "../../src/features/campaign-evaluation/service";
import { developmentEvaluationProvider, syntheticCampaignAnalytics } from "../../src/features/campaign-evaluation/development-provider";
import { EvaluationViewSchema } from "../../src/features/campaign-evaluation/contracts";
import { evaluationEnvironment } from "../fixtures/evaluation";

let tokenA: string; let tokenB: string; let a: SupabaseTransport; let b: SupabaseTransport;
const scope = { businessId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1", ownerUserId: "11111111-1111-4111-8111-111111111111" };
const prior = { NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY };
beforeAll(async () => {
  const env = Object.fromEntries(readFileSync(".env.local", "utf8").split(/\r?\n/).map((line) => { const at = line.indexOf("="); return [line.slice(0, at), line.slice(at + 1)]; }));
  expect(env.NEXT_PUBLIC_SUPABASE_URL).toBe("http://127.0.0.1:54321"); for (const key of Object.keys(prior)) process.env[key] = env[key];
  [tokenA, tokenB] = z.array(z.string()).length(2).parse(await fixtureTokens()); a = supabaseTransport(tokenA); b = supabaseTransport(tokenB);
});
afterAll(() => { for (const [key, value] of Object.entries(prior)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
async function setup(withExpense = true) {
  const fixture = await createEvaluationFixture(tokenA, false); const id = z.uuid().parse(fixture.campaignId);
  const closedView = await call(tokenA, "campaigns", undefined, `?campaignId=${id}`); expect(closedView.status).toBe(200); const published = ExecutionViewSchema.parse(closedView.body);
  const repository = evaluationRepository(a, privilegedTransport, scope); const now = () => new Date().toISOString();
  const dependencies = { now, ownerUserId: scope.ownerUserId, enabled: true, databaseError: evaluationDatabaseError,
    analytics: async (facts: Awaited<ReturnType<typeof repository.facts>>, scenario: unknown, at: string) => syntheticCampaignAnalytics(facts.snapshot, scenario, at, evaluationEnvironment),
    provider: vi.fn((scenario: "valid" | "failure" | "invalid") => developmentEvaluationProvider(scenario, evaluationEnvironment)) };
  const service = evaluationService(repository, dependencies);
  if (withExpense) {
    await service.createCost({ campaignId: id, requestId: randomUUID(), category: "advertising", description: "Slice 7 integration expense synthetic", amountIdr: 50000, incurredAt: now() });
    await service.reviewCosts({ campaignId: id, expectedCampaignVersion: (await repository.facts(id)).snapshot.campaign.version, confirm: true });
  }
  async function command(scenario = "exceeds_target", providerScenario = "valid") {
    const context = await service.context(id, scenario);
    return { campaignId: id, requestId: randomUUID(), expectedCampaignVersion: context.snapshot.campaign.version, expectedContextHash: context.contextHash,
      expectedEvaluationId: await repository.latestId(id), analyticsScenario: scenario, providerScenario };
  }
  const task = published.tasks.find((entry) => entry.completed_at === null); if (!task) throw new Error("No incomplete fixture task");
  return { id, repository, service, command, dependencies, now, task };
}
describe("actual Supabase provisional evaluation and cost ledger", () => {
  it("persists one validated synthetic snapshot, reloads it and replays without another provider call", async () => {
    const f = await setup(); const command = await f.command(); const first = EvaluationViewSchema.parse(await f.service.generate(command));
    expect(first.history).toHaveLength(1); const row = first.history[0].row;
    expect(row).toMatchObject({ id: command.requestId, evaluation_kind: "provisional", source_ai_generation_id: null, analysis_json: { status: "available", synthetic: true, review: { status: "unreviewed" } } });
    expect(row.metrics_json.summary).toMatchObject({ contributionIdr: 214000, actualPromotionSpendIdr: 50000, synthetic: true });
    expect(row.metrics_json.context.analytics).toMatchObject({ status: "available", data: { provenance: "development_fixture", financialScopeOrderIds: null } });
    const handoff = evaluationHandoff(row, first.context.contextHash);
    expect(handoff.productionEligible).toBe(false); expect(handoff.sourceVersions.campaignVersion).toBe(first.context.snapshot.campaign.version);
    expect(handoff.sourceVersions.tasks).toHaveLength(first.context.snapshot.tasks.length);
    expect((await f.service.generate(command)).replayed).toBe(true); expect(f.dependencies.provider).toHaveBeenCalledTimes(1);
    await expect(f.service.generate({ ...command, providerScenario: "failure" })).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    expect((await evaluationRepository(a, privilegedTransport, scope).evaluation(row.id))?.metrics_json.context.contextHash).toBe(row.metrics_json.context.contextHash);
    const invalidId = randomUUID();
    await expect(privilegedTransport().rpc("record_campaign_evaluation", { p_business_id: scope.businessId, p_campaign_id: f.id, p_blueprint_id: randomUUID(),
      p_evaluation_id: invalidId, p_kind: "provisional", p_metrics: { ...row.metrics_json, cas: undefined }, p_analysis: row.analysis_json, p_limitations: row.limitations_json,
      p_calculated_at: row.calculated_at, p_actor_user_id: scope.ownerUserId })).rejects.toMatchObject({ code: "23503" });
    expect(await f.repository.evaluation(invalidId)).toBeNull(); expect((await f.repository.history(f.id)).records).toHaveLength(1);
  });
  it("reconciles concurrent identical evaluation UUIDs without duplicate history", async () => {
    const f = await setup(); const command = await f.command(); await Promise.all([f.service.generate(command), f.service.generate(command)]);
    expect((await f.repository.history(f.id)).records).toHaveLength(1);
  });
  it("appends explicit owner review without mutating the parent and rejects stale source review", async () => {
    const f = await setup(); const command = await f.command(); await f.service.generate(command);
    const ctx = await f.service.context(f.id, "exceeds_target");
    const review = { campaignId: f.id, requestId: randomUUID(), evaluationId: command.requestId, expectedCampaignVersion: ctx.snapshot.campaign.version, expectedContextHash: ctx.contextHash, confirm: true };
    const result = await f.service.review(review); expect(result.history).toHaveLength(2);
    expect((await f.repository.evaluation(command.requestId))?.analysis_json.review.status).toBe("unreviewed");
    expect((await f.repository.evaluation(review.requestId))?.analysis_json.review).toMatchObject({ status: "reviewed", reviewedByUserId: scope.ownerUserId });
    expect((await f.service.review(review)).replayed).toBe(true);
    await expect(privilegedTransport().update("campaign_evaluations", { id: `eq.${command.requestId}` }, { evaluation_kind: "final" })).rejects.toMatchObject({ code: "23514" });
    await f.service.createCost({ campaignId: f.id, requestId: randomUUID(), category: "other", description: "Synthetic correction", amountIdr: 1, incurredAt: f.now() });
    const current = await f.service.context(f.id, "exceeds_target");
    await expect(f.service.review({ ...review, requestId: randomUUID(), expectedCampaignVersion: current.snapshot.campaign.version })).rejects.toMatchObject({ code: "STALE_CONTEXT" });
    expect((await f.repository.history(f.id)).records).toHaveLength(2);
  });
  it("records concurrent duplicate cost once, reviews zero explicitly and preserves void audit/CAS", async () => {
    const f = await setup(false); const input = { campaignId: f.id, requestId: randomUUID(), category: "advertising", description: "Known synthetic expense", amountIdr: 50000, incurredAt: f.now() };
    await Promise.all([f.service.createCost(input), f.service.createCost(input)]); expect((await f.repository.facts(f.id)).costs).toHaveLength(1);
    await expect(f.service.createCost({ ...input, amountIdr: 2 })).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    const source = await f.repository.facts(f.id); const review = { campaignId: f.id, expectedCampaignVersion: source.snapshot.campaign.version, confirm: true };
    await Promise.all([f.service.reviewCosts(review), f.service.reviewCosts(review)]);
    const after = await f.repository.facts(f.id); expect(after.snapshot.campaign.version).toBe(source.snapshot.campaign.version + 1);
    const correction = { campaignId: f.id, costId: input.requestId, expectedCostVersion: 1, reason: "Synthetic void correction" };
    await f.service.voidCost(correction); expect((await f.service.voidCost(correction)).replayed).toBe(true);
    expect((await f.repository.facts(f.id)).costsCompleteness).toBe("unreviewed");
    expect((await f.repository.cost(input.requestId))).toMatchObject({ amount_idr: 50000, version: 2, void_reason: correction.reason });
    await expect(f.service.voidCost({ ...correction, reason: "Other stale reason" })).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    expect((await f.service.createCost(input)).replayed).toBe(true);
    await f.service.reviewCosts({ ...review, expectedCampaignVersion: (await f.repository.facts(f.id)).snapshot.campaign.version });
    expect((await f.service.view(f.id)).summary.actualPromotionSpendIdr).toBe(0);
  });
  it("saves failure/invalid narratives and unavailable KPI as explicit provisional history", async () => {
    const f = await setup();
    for (const scenario of ["failure", "invalid"]) {
      const command = await f.command("exceeds_target", scenario); await f.service.generate(command);
      const row = await f.repository.evaluation(command.requestId); expect(row?.analysis_json.status).toBe(scenario === "failure" ? "failed" : "invalid"); expect(row?.analysis_json.narrative).toBeNull();
    }
    const command = await f.command("unavailable"); const view = await f.service.generate(command);
    expect(view.summary.observed.paidUnitsInWindow).toBeNull(); expect(view.summary.contributionIdr).toBeNull(); expect(view.history).toHaveLength(3);
  });
  it("revalidates checklist change after provider output and writes no stale snapshot", async () => {
    const f = await setup(); const command = await f.command();
    const service = evaluationService(f.repository, { ...f.dependencies, provider: () => ({ generate: async (input) => {
      const changed = await call(tokenA, "campaigns", { action: "task", campaignId: f.id, blueprintId: f.task.blueprint_id, taskId: f.task.id, expectedTaskVersion: f.task.version, completed: true }); expect(changed.status).toBe(200);
      return developmentEvaluationProvider("valid", evaluationEnvironment).generate(input);
    } }) });
    await expect(service.generate(command)).rejects.toMatchObject({ code: "STALE_CONTEXT" }); expect((await f.repository.history(f.id)).records).toHaveLength(0);
  });
  it("rejects a cost committed after preflight through database CAS and leaves no stale snapshot", async () => {
    const f = await setup(); const command = await f.command();
    const repository = { ...f.repository, save: async (...args: Parameters<typeof f.repository.save>) => {
      await f.service.createCost({ campaignId: f.id, requestId: randomUUID(), category: "other", description: "Concurrent synthetic expense", amountIdr: 1, incurredAt: f.now() });
      return f.repository.save(...args);
    } };
    await expect(evaluationService(repository, f.dependencies).generate(command)).rejects.toMatchObject({ code: "STALE_SOURCE_STATE" });
    expect((await f.repository.history(f.id)).records).toHaveLength(0);
  });
  it("denies actual foreign JWT reads/costs/evaluation writes and blocks unreviewed completion with no memory", async () => {
    const f = await setup(); const command = await f.command(); const generated = await f.service.generate(command);
    const foreign = evaluationRepository(b, privilegedTransport, scope); const service = evaluationService(foreign, f.dependencies);
    await expect(service.view(f.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(service.generate(command)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(service.createCost({ campaignId: f.id, requestId: randomUUID(), category: "other", description: "Denied", amountIdr: 1, incurredAt: f.now() })).rejects.toMatchObject({ code: "NOT_FOUND" });
    const row = generated.history[0].row;
    await expect(b.rpc("record_campaign_evaluation", { p_business_id: scope.businessId, p_campaign_id: f.id, p_blueprint_id: row.blueprint_id, p_evaluation_id: randomUUID(),
      p_kind: "provisional", p_metrics: {}, p_analysis: {}, p_limitations: [], p_calculated_at: f.now(), p_actor_user_id: scope.ownerUserId })).rejects.toMatchObject({ code: "42501" });
    await expect(f.service.finalize({ campaignId: f.id, requestId: randomUUID(), evaluationId: row.id, expectedCampaignVersion: generated.context.snapshot.campaign.version,
      expectedContextHash: generated.context.contextHash, confirm: true })).rejects.toMatchObject({ code: "OWNER_REVIEW_REQUIRED" });
    expect((await f.repository.facts(f.id)).snapshot.campaign).toMatchObject({ status: "closed", completed_at: null });
    expect(await a.select("campaign_memories", { select: "id", campaign_id: `eq.${f.id}` })).toEqual([]);
  });
});
