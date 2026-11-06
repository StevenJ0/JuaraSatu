import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { evaluationFixture, evaluationEnvironment } from "../fixtures/evaluation";
import { EvaluationNarrativeSchema, EvaluationRowSchema, type EvaluationRow } from "../../src/features/campaign-evaluation/contracts";
import { calculateEvaluation } from "../../src/features/campaign-evaluation/calculate";
import { evaluationService, evaluationHandoff } from "../../src/features/campaign-evaluation/service";
import type { EvaluationRepository } from "../../src/features/campaign-evaluation/repository.server";
import { developmentEvaluationProvider, syntheticCampaignAnalytics } from "../../src/features/campaign-evaluation/development-provider";
import { configuredEvaluationProvider } from "../../src/features/campaign-evaluation/gemini.server";
import { generationClaimFixture } from "../fixtures/generation-claims";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });
async function setup(patch: Record<string, unknown> = {}) {
  const f = await evaluationFixture(), rows: EvaluationRow[] = [], owner = randomUUID();
  const summary = calculateEvaluation(f.context);
  const narrative = EvaluationNarrativeSchema.parse(await developmentEvaluationProvider("valid", evaluationEnvironment).generate({ summary, references: f.context.references }));
  const fetcher = vi.fn<typeof fetch>(async () => Response.json({ status: "completed",
    steps: [{ type: "model_output", content: [{ type: "text", text: JSON.stringify({ ...narrative, summary: "Terdapat ketidakpastian hasil promosi.", ...patch }) }] }] }));
  vi.stubGlobal("fetch", fetcher);
  const save = vi.fn<EvaluationRepository["save"]>(async (id, metrics, analysis, expectedEvaluationId) => {
    expect(rows[0]?.id ?? null).toBe(expectedEvaluationId);
    rows.unshift(EvaluationRowSchema.parse({ id, business_id: f.context.snapshot.campaign.business_id, campaign_id: f.context.snapshot.campaign.id,
      blueprint_id: f.context.snapshot.blueprint?.id, metrics_schema_version: 1, metrics_json: { ...metrics, cas: { expectedEvaluationId } }, analysis_json: analysis,
      limitations_json: f.context.limitations, evaluation_kind: "provisional", calculated_at: f.now, evaluated_at: f.now, source_ai_generation_id: null }));
    return null;
  });
  const repository: EvaluationRepository = {
    generations: generationClaimFixture(f.context.snapshot.campaign.business_id, () => f.now).instance(),
    facts: async () => ({ snapshot: f.context.snapshot, costs: f.context.costs, costsCompleteness: f.context.costsCompleteness }),
    evaluation: async id => structuredClone(rows.find(row => row.id === id) ?? null),
    history: async () => ({ records: structuredClone(rows), unsupportedCount: 0 }),
    latestId: async () => rows[0]?.id ?? null, save,
    list: async () => [], cost: async () => null, finalize: async () => { throw Error("Finalization is outside this test"); },
    createCost: async () => { throw Error("No expenses written"); }, voidCost: async () => [], reviewCosts: async () => [],
  };
  const env = { NODE_ENV: "test", CAMPAIGN_EVALUATION_MODE: "synthetic", CAMPAIGN_EVALUATION_PROVIDER: "gemini",
    GEMINI_API_KEY: "synthetic-no-network", GEMINI_MODEL: "gemini-3.6-flash", GEMINI_TIMEOUT_MS: "60000" };
  const service = evaluationService(repository, {
    now: () => f.now, ownerUserId: owner, enabled: true, provider: scenario => configuredEvaluationProvider(scenario, env),
    analytics: async (facts, scenario, now) => syntheticCampaignAnalytics(facts.snapshot, scenario, now, evaluationEnvironment),
    databaseError(error): never { throw error; },
  });
  const command = { campaignId: f.context.snapshot.campaign.id, requestId: randomUUID(), expectedCampaignVersion: f.context.snapshot.campaign.version,
    expectedEvaluationId: null, expectedContextHash: f.context.contextHash, analyticsScenario: "exceeds_target", providerScenario: "valid" };
  return { ...f, rows, owner, fetcher, save, repository, service, command };
}
describe("Evaluation: installed SDK with mocked HTTP and repository port", () => {
  it("persists genuine uncertainty with null provider ID, replays once and appends owner review", async () => {
    const f = await setup();
    const result = await f.service.generate(f.command), row = result.history[0].row;
    expect(row.analysis_json).toMatchObject({ provider: "gemini", model: "gemini-3.6-flash", providerRequestId: null, generatedAt: f.now, status: "available", synthetic: true });
    expect(row.metrics_json.summary).toMatchObject({ actualPromotionSpendIdr: 50000, contributionIdr: 214000, synthetic: true });
    expect(evaluationHandoff(row, result.context.contextHash).productionEligible).toBe(false);
    expect((await f.service.generate(f.command)).replayed).toBe(true);
    await expect(f.service.generate({ ...f.command, providerScenario: "invalid" })).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    const review = { campaignId: f.command.campaignId, requestId: randomUUID(), evaluationId: row.id, expectedCampaignVersion: f.command.expectedCampaignVersion,
      expectedContextHash: f.command.expectedContextHash, confirm: true };
    await f.service.review(review);
    expect((await f.repository.evaluation(row.id))?.analysis_json.review.status).toBe("unreviewed");
    expect((await f.repository.evaluation(review.requestId))?.analysis_json).toMatchObject({ provider: "gemini", providerRequestId: null,
      review: { status: "reviewed", reviewedByUserId: f.owner } });
    expect((await f.service.review(review)).replayed).toBe(true);
    expect(f.save).toHaveBeenCalledTimes(2); expect(f.fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([
    { summary: "Penjualan pasti meningkat." },
    { financialState: "unknown" },
    { authoritativeRevenue: 999999 },
    { evidenceReferences: ["invented"] },
  ])("persists rejected output truthfully and blocks owner review: %s", async patch => {
    vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("GEMINI_DEBUG", "true");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const f = await setup(patch), result = await f.service.generate(f.command);
    const row = result.history[0].row;
    expect(row.analysis_json).toMatchObject({ status: "invalid", narrative: null, provider: "gemini", providerRequestId: null, generatedAt: f.now, review: { status: "unreviewed" } });
    expect(row.metrics_json.summary.contributionIdr).toBe(214000);
    expect((await f.service.generate(f.command)).replayed).toBe(true);
    await expect(f.service.review({ campaignId: f.command.campaignId, requestId: randomUUID(), evaluationId: row.id,
      expectedCampaignVersion: f.command.expectedCampaignVersion, expectedContextHash: f.command.expectedContextHash, confirm: true }))
      .rejects.toMatchObject({ code: "NARRATIVE_REVIEW_UNAVAILABLE" });
    const events = vi.mocked(console.warn).mock.calls.filter(([tag]) => tag === "Evaluation output rejected");
    expect(events).toHaveLength(1); expect(JSON.parse(String(events[0][1]))).toMatchObject({ requestId: f.command.requestId });
    expect(f.save).toHaveBeenCalledTimes(1); expect(f.fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([
    { expectedCampaignVersion: 1, expectedCode: "VERSION_CONFLICT" },
    { expectedContextHash: "0".repeat(64), expectedCode: "STALE_CONTEXT" },
    { expectedEvaluationId: "ffffffff-ffff-4fff-8fff-ffffffffffff", expectedCode: "STALE_EVALUATION_VERSION" },
  ])("rejects stale preflight without inference: %s", async ({ expectedCode, ...patch }) => {
    const f = await setup();
    await expect(f.service.generate({ ...f.command, ...patch })).rejects.toMatchObject({ code: expectedCode });
    expect(f.fetcher).not.toHaveBeenCalled(); expect(f.save).not.toHaveBeenCalled();
  });
  it("rejects a source change during inference before persistence", async () => {
    const f = await setup(), original = f.fetcher.getMockImplementation();
    if (!original) throw Error("Missing HTTP mock");
    f.fetcher.mockImplementation(async (...args) => {
      f.context.snapshot.tasks[0].version++;
      return original(...args);
    });
    await expect(f.service.generate(f.command)).rejects.toMatchObject({ code: "STALE_CONTEXT" });
    expect(f.fetcher).toHaveBeenCalledTimes(1); expect(f.save).not.toHaveBeenCalled();
  });
  it("rejects a tampered historical financial snapshot without regenerating", async () => {
    const f = await setup(); await f.service.generate(f.command);
    f.rows[0].metrics_json.summary.contributionIdr = 1;
    await expect(f.service.view(f.command.campaignId)).rejects.toMatchObject({ code: "INVALID_SNAPSHOT" });
    expect(f.fetcher).toHaveBeenCalledTimes(1);
  });
});

it("aborts one 60s SDK request, persists failed provenance once and replays without generation", async () => {
  vi.useFakeTimers();
  const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    const f = await setup(), aborted = vi.fn();
    f.fetcher.mockImplementation(async (input, init) => {
      const request = new Request(input, init);
      return new Promise<Response>((_resolve, reject) => {
        const cancel = () => { aborted(); reject(request.signal.reason); };
        if (request.signal.aborted) cancel(); else request.signal.addEventListener("abort", cancel, { once: true });
      });
    });
    const pending = f.service.generate(f.command);
    await vi.advanceTimersByTimeAsync(59_999);
    expect(f.save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2);
    const result = await pending;
    expect(aborted).toHaveBeenCalledTimes(1);
    expect(result.history[0].row.analysis_json).toMatchObject({ provider: "gemini", status: "failed", narrative: null, providerRequestId: null,
      model: "gemini-3.6-flash", generatedAt: f.now, review: { status: "unreviewed" } });
    expect(warning).toHaveBeenCalledWith("Gemini request failed", expect.objectContaining({ code: "PROVIDER_TIMEOUT" }));
    expect((await f.service.generate(f.command)).replayed).toBe(true);
    expect(f.fetcher).toHaveBeenCalledTimes(1); expect(f.save).toHaveBeenCalledTimes(1);
  } finally { vi.useRealTimers(); }
});

it("records correlated phase timings for the actual SDK/service path without logging model data", async () => {
  vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("GEMINI_DEBUG", "true");
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  const f = await setup(); await f.service.generate(f.command);
  const rows = log.mock.calls.filter(([tag]) => tag === "[EVALUATION_PERF]").map(call => JSON.parse(String(call[1])));
  for (const phase of ["database", "context", "calculation", "prompt", "provider", "validation", "persistence"]) {
    expect(rows).toContainEqual(expect.objectContaining({ phase, requestId: f.command.requestId, success: true, durationMs: expect.any(Number) }));
  }
  expect(rows.every(row => row.requestId === f.command.requestId)).toBe(true);
  expect(JSON.stringify(rows)).not.toMatch(/ketidakpastian|synthetic-no-network|532000|214000/);
  const requestEvents = log.mock.calls.filter(([tag]) => tag === "[GEMINI_DEBUG]").map(call => JSON.parse(String(call[1])));
  expect(requestEvents).toContainEqual(expect.objectContaining({ requestId: f.command.requestId, stage: "SDK_REQUEST", result: "STARTED" }));
  expect(f.fetcher).toHaveBeenCalledTimes(1);
});
