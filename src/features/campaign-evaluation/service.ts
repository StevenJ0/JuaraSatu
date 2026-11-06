import { fingerprint } from "../campaign-blueprint";
import { supabaseUtcTimestamp } from "@/lib/supabase/timestamps";
import { buildEvaluationContext, evaluationWindow } from "./context";
import { measureEvaluation, recordEvaluationTiming } from "./performance";
import { calculateEvaluation } from "./calculate";
import { interpretEvaluation, validateEvaluationNarrative } from "./engine";
import { EvaluationError, EvaluationCommandSchema, EvaluationReviewCommandSchema, CostCreateCommandSchema, CostVoidCommandSchema, CostReviewCommandSchema,
  FinalizeCommandSchema, MetricsEnvelopeSchema, AnalysisSchema, type AnalyticsRead, type EvaluationContext, type EvaluationProvider, type EvaluationRow, type CampaignCost } from "./contracts";
import type { EvaluationRepository } from "./repository.server";

export function evaluationCurrentHash(current: EvaluationContext, row: EvaluationRow) {
  const audit = row.metrics_json.finalization; const c = current.snapshot.campaign;
  if (!audit || c.status !== "completed" || c.version !== audit.completedCampaignVersion || !c.completed_at ||
    Date.parse(c.completed_at) !== Date.parse(audit.completedAt)) return current.contextHash;
  // Completion advances lifecycle once; the sealed source facts retain their pre-completion revision.
  return buildEvaluationContext({ ...current, now: current.calculatedAt, snapshot: { ...current.snapshot,
    campaign: { ...c, status: "closed", version: audit.expectedCampaignVersion, completed_at: null } },
    analytics: current.analytics.status === "available" ? { ...current.analytics, data: { ...current.analytics.data, campaignVersion: audit.expectedCampaignVersion } } : current.analytics }).contextHash;
}
export function evaluationFinalization(current: EvaluationContext, latest: EvaluationRow | null, latestId: string | null) {
  const blockers: string[] = [];
  if (current.snapshot.campaign.status !== "closed") blockers.push("CLOSED_CAMPAIGN_REQUIRED");
  if (!latest || latest.id !== latestId) blockers.push("EVALUATION_REQUIRED");
  else {
    if (latest.analysis_json.review.status !== "reviewed" || !latest.metrics_json.cas) blockers.push("OWNER_REVIEW_REQUIRED");
    if (latest.metrics_json.context.contextHash !== current.contextHash) blockers.push("STALE_SOURCE_STATE");
  }
  if (current.costsCompleteness !== "confirmed_complete") blockers.push("COSTS_INCOMPLETE");
  const a = current.analytics.status === "available" ? current.analytics.data : null;
  if (!a || !a.costsComplete || a.operationallyResolved !== true || a.metrics.paidUnitsInWindow === null ||
    a.metrics.scopedFulfilledSalesValueIdr === null || a.metrics.scopedProductionCostIncurredIdr === null) blockers.push("KPI_INCOMPLETE");
  if (a?.provenance !== "development_fixture") blockers.push("VERIFIED_C6_UNAVAILABLE");
  return { eligible: blockers.length === 0, productionEligible: false as const, mode: "development_synthetic" as const,
    code: blockers[0] ?? null, blockers, evaluationId: latestId };
}
export function evaluationHandoff(row: EvaluationRow, currentHash: string | null) {
  const stored = row.metrics_json.context;
  const validated = buildEvaluationContext({ snapshot: stored.snapshot, costs: stored.costs, costsCompleteness: stored.costsCompleteness,
    analytics: stored.analytics, analyticsScenario: stored.analyticsScenario, now: stored.calculatedAt });
  if (validated.contextHash !== stored.contextHash) throw new EvaluationError("INVALID_SNAPSHOT");
  const calculated = calculateEvaluation(validated);
  const historical = row.metrics_json.summary.finalizationBlockers[0] === "FINALIZATION_DATABASE_CAPABILITY_MISSING"
    ? { ...calculated, finalizationBlockers: ["FINALIZATION_DATABASE_CAPABILITY_MISSING", ...calculated.finalizationBlockers.slice(1)] } : calculated;
  if (fingerprint(historical) !== fingerprint(row.metrics_json.summary) || row.business_id !== row.metrics_json.context.snapshot.campaign.business_id ||
    row.campaign_id !== row.metrics_json.context.snapshot.campaign.id || row.blueprint_id !== row.metrics_json.context.snapshot.blueprint?.id) throw new EvaluationError("INVALID_SNAPSHOT");
  if (row.analysis_json.narrative) validateEvaluationNarrative(row.analysis_json.narrative, row.metrics_json.context, calculated);
  const audit = row.metrics_json.finalization;
  if (audit && (audit.requestId !== row.id || audit.reviewedEvaluationId !== row.metrics_json.parentEvaluationId || audit.sourceContextHash !== stored.contextHash ||
    audit.expectedCampaignVersion !== stored.snapshot.campaign.version || audit.completedCampaignVersion !== audit.expectedCampaignVersion + 1 ||
    audit.actorUserId !== row.analysis_json.review.reviewedByUserId || stored.snapshot.campaign.status !== "closed")) throw new EvaluationError("INVALID_SNAPSHOT");
  return { productionEligible: false as const, developmentEligible: !!audit && currentHash === stored.contextHash && row.analysis_json.review.status === "reviewed",
    exclusions: ["SYNTHETIC_EVALUATION", ...(audit ? [] : ["PROVISIONAL_EVALUATION", "CAMPAIGN_NOT_COMPLETED"]), ...(currentHash !== stored.contextHash ? ["STALE_CONTEXT"] : []),
    ...(row.analysis_json.review.status !== "reviewed" ? ["OWNER_REVIEW_REQUIRED"] : [])],
    businessId: row.business_id, campaignId: row.campaign_id, blueprintId: row.blueprint_id, evaluationId: row.id, contextHash: row.metrics_json.context.contextHash,
    sourceFactsAt: row.metrics_json.sourceFactsAt, strategy: row.metrics_json.context.snapshot.blueprint?.blueprint_json,
    sourceVersions: { campaignVersion: stored.snapshot.campaign.version, preorderVersion: stored.snapshot.preorder.version, preorderItemVersion: stored.snapshot.item.version,
      blueprintVersion: stored.snapshot.blueprint?.version ?? null, tasks: stored.snapshot.tasks.map((task) => ({ id: task.id, version: task.version })),
      costs: stored.costs.map((cost) => ({ id: cost.id, version: cost.version })),
      analytics: stored.analytics.status === "available" ? { sourceId: stored.analytics.data.sourceId, sourceVersion: stored.analytics.data.sourceVersion } : null },
    results: calculated, analyticsProvenance: row.metrics_json.context.analytics, recordedCosts: row.metrics_json.context.costs,
    execution: row.metrics_json.context.snapshot.tasks, findings: row.analysis_json.narrative, review: row.analysis_json.review,
    limitations: row.limitations_json, finalizationState: audit ? "completed" : stored.snapshot.campaign.status, completion: audit ?? null,
    preorderId: stored.snapshot.preorder.id };
}
export function evaluationService(repository: EvaluationRepository, dependencies: {
  now(): string; ownerUserId: string; enabled: boolean;
  analytics(facts: Awaited<ReturnType<EvaluationRepository["facts"]>>, scenario: unknown, now: string): Promise<AnalyticsRead>;
  provider(scenario: "valid" | "failure" | "invalid"): EvaluationProvider; databaseError(error: unknown): never;
}) {
  function guard() { if (!dependencies.enabled) throw new EvaluationError("SYNTHETIC_EVALUATION_DISABLED", 503); }
  async function context(id: string, scenario: unknown, requestId: string | null = null): Promise<EvaluationContext> {
    return measureEvaluation("context", requestId, async () => {
      guard(); const facts = await measureEvaluation("database", requestId, () => repository.facts(id), "facts"); const now = dependencies.now();
      return buildEvaluationContext({ ...facts, analytics: await dependencies.analytics(facts, scenario, now), analyticsScenario: scenario, now });
    });
  }
  async function view(campaignId: string, scenario: unknown = "exceeds_target", requestId: string | null = null) {
    const current = await context(campaignId, scenario, requestId);
    const history = await measureEvaluation("database", requestId, () => repository.history(campaignId), "history");
    const latestEvaluationId = await measureEvaluation("database", requestId, () => repository.latestId(campaignId), "latest");
    return { context: current, summary: calculateEvaluation(current), measurementWindow: evaluationWindow(current.snapshot, current.calculatedAt), history: history.records.map((row) => ({ row,
      stale: row.metrics_json.context.contextHash !== evaluationCurrentHash(current, row), memoryExclusions: evaluationHandoff(row, evaluationCurrentHash(current, row)).exclusions })), unsupportedCount: history.unsupportedCount,
      latestEvaluationId, finalization: evaluationFinalization(current, history.records.find((row) => row.id === latestEvaluationId) ?? null, latestEvaluationId), synthetic: true as const };
  }
  function requireVersion(ctx: EvaluationContext, version: number, hash: string) {
    if (ctx.snapshot.campaign.status !== "closed") throw new EvaluationError("CLOSED_CAMPAIGN_REQUIRED");
    if (ctx.snapshot.campaign.version !== version) throw new EvaluationError("VERSION_CONFLICT");
    if (ctx.contextHash !== hash) throw new EvaluationError("STALE_CONTEXT");
  }
  async function replay(id: string, campaignId: string, hash: string) {
    const prior = await measureEvaluation("database", id, () => repository.evaluation(id), "evaluation"); if (!prior) return null;
    if (prior.campaign_id !== campaignId || prior.metrics_json.commandHash !== hash) throw new EvaluationError("IDEMPOTENCY_CONFLICT"); return prior;
  }
  async function persist(id: string, metrics: EvaluationRow["metrics_json"], analysis: EvaluationRow["analysis_json"], expectedEvaluationId: string | null) {
    try { await measureEvaluation("database", id, () => repository.save(id, metrics, analysis, expectedEvaluationId), "save"); }
    catch (error) { const prior = await replay(id, metrics.context.snapshot.campaign.id, metrics.commandHash); if (prior) return true; return dependencies.databaseError(error); }
    return false;
  }
  async function closed(campaignId: string) { const facts = await repository.facts(campaignId); if (facts.snapshot.campaign.status !== "closed") throw new EvaluationError("CLOSED_CAMPAIGN_REQUIRED"); return facts; }
  return { context, view,
    async generate(raw: unknown) {
      guard(); const command = EvaluationCommandSchema.parse(raw); const hash = fingerprint({ action: "generate", ...command });
      if (await replay(command.requestId, command.campaignId, hash)) return { ...await view(command.campaignId, command.analyticsScenario, command.requestId), replayed: true };
      const source = await context(command.campaignId, command.analyticsScenario, command.requestId); requireVersion(source, command.expectedCampaignVersion, command.expectedContextHash);
      if (await measureEvaluation("database", command.requestId, () => repository.latestId(command.campaignId), "latest") !== command.expectedEvaluationId) throw new EvaluationError("STALE_EVALUATION_VERSION");
      const calculationStarted = performance.now(); const summary = calculateEvaluation(source);
      recordEvaluationTiming("calculation", command.requestId, performance.now() - calculationStarted);
      const provider = dependencies.provider(command.providerScenario);
      const analysis = await repository.generations.run({ type: "evaluation", requestKey: command.requestId, inputHash: hash,
        preorderId: source.snapshot.campaign.preorder_id, model: provider.kind === "gemini" ? provider.model : "development-fake-evaluation" }, AnalysisSchema,
        () => interpretEvaluation(source, summary, provider, dependencies.now, command.requestId));
      const fresh = await context(command.campaignId, command.analyticsScenario, command.requestId); requireVersion(fresh, command.expectedCampaignVersion, command.expectedContextHash);
      const metrics = MetricsEnvelopeSchema.parse({ schemaVersion: 1, context: source, summary, commandHash: hash, parentEvaluationId: null, sourceFactsAt: source.calculatedAt });
      const replayed = await measureEvaluation("persistence", command.requestId, () => persist(command.requestId, metrics, analysis, command.expectedEvaluationId));
      return { ...await view(command.campaignId, command.analyticsScenario, command.requestId), replayed };
    },
    async review(raw: unknown) {
      guard(); const command = EvaluationReviewCommandSchema.parse(raw); const hash = fingerprint({ action: "review", ...command });
      const parent = await repository.evaluation(command.evaluationId); if (!parent || parent.campaign_id !== command.campaignId) throw new EvaluationError("NOT_FOUND", 404);
      const scenario = parent.metrics_json.context.analyticsScenario;
      if (await replay(command.requestId, command.campaignId, hash)) return { ...await view(command.campaignId, scenario), replayed: true };
      const current = await context(command.campaignId, scenario); requireVersion(current, command.expectedCampaignVersion, command.expectedContextHash);
      if (parent.metrics_json.context.contextHash !== current.contextHash) throw new EvaluationError("STALE_CONTEXT");
      evaluationHandoff(parent, current.contextHash);
      if (parent.analysis_json.status !== "available" || !parent.analysis_json.narrative) throw new EvaluationError("NARRATIVE_REVIEW_UNAVAILABLE");
      const analysis = AnalysisSchema.parse({ ...parent.analysis_json, review: { status: "reviewed", reviewedByUserId: dependencies.ownerUserId, reviewedAt: dependencies.now() } });
      const metrics = MetricsEnvelopeSchema.parse({ ...parent.metrics_json, commandHash: hash, parentEvaluationId: parent.id });
      const replayed = await persist(command.requestId, metrics, analysis, parent.id);
      return { ...await view(command.campaignId, scenario), replayed };
    },
    async createCost(raw: unknown) {
      guard(); const command = CostCreateCommandSchema.parse(raw); await closed(command.campaignId);
      if (Date.parse(command.incurredAt) > Date.parse(dependencies.now())) throw new EvaluationError("FUTURE_COST", 400);
      function matches(cost: CampaignCost) { return cost.campaign_id === command.campaignId && cost.category === command.category && cost.description === command.description &&
        cost.amount_idr === command.amountIdr && supabaseUtcTimestamp(cost.incurred_at) === supabaseUtcTimestamp(command.incurredAt); }
      const prior = await repository.cost(command.requestId); if (prior) { if (!matches(prior)) throw new EvaluationError("IDEMPOTENCY_CONFLICT"); return { replayed: true }; }
      try { await repository.createCost(command); return { replayed: false }; }
      catch (error) { const stored = await repository.cost(command.requestId); if (stored && matches(stored)) return { replayed: true }; return dependencies.databaseError(error); }
    },
    async voidCost(raw: unknown) {
      guard(); const command = CostVoidCommandSchema.parse(raw); await closed(command.campaignId); const row = await repository.cost(command.costId);
      if (!row || row.campaign_id !== command.campaignId) throw new EvaluationError("NOT_FOUND", 404);
      if (row.voided_at && row.void_reason === command.reason && row.version === command.expectedCostVersion + 1) return { replayed: true };
      if (row.version !== command.expectedCostVersion || row.voided_at) throw new EvaluationError("VERSION_CONFLICT");
      try { const changed = await repository.voidCost(row, dependencies.now(), command.reason); if (changed.length) return { replayed: false }; }
      catch (error) { const latest = await repository.cost(row.id); if (latest?.voided_at && latest.version === command.expectedCostVersion + 1 && latest.void_reason === command.reason) return { replayed: true }; return dependencies.databaseError(error); }
      const latest = await repository.cost(row.id); if (latest?.voided_at && latest.version === command.expectedCostVersion + 1 && latest.void_reason === command.reason) return { replayed: true };
      throw new EvaluationError("VERSION_CONFLICT");
    },
    async reviewCosts(raw: unknown) {
      guard(); const command = CostReviewCommandSchema.parse(raw); const source = await closed(command.campaignId);
      if ([command.expectedCampaignVersion, command.expectedCampaignVersion + 1].includes(source.snapshot.campaign.version) && source.costsCompleteness === "confirmed_complete") return { replayed: true };
      if (source.snapshot.campaign.version !== command.expectedCampaignVersion) throw new EvaluationError("VERSION_CONFLICT");
      try { const changed = await repository.reviewCosts(command.campaignId, command.expectedCampaignVersion); if (changed.length) return { replayed: false }; }
      catch (error) { const latest = await closed(command.campaignId); if (latest.snapshot.campaign.version === command.expectedCampaignVersion + 1 && latest.costsCompleteness === "confirmed_complete") return { replayed: true }; return dependencies.databaseError(error); }
      const latest = await closed(command.campaignId);
      if (latest.snapshot.campaign.version === command.expectedCampaignVersion + 1 && latest.costsCompleteness === "confirmed_complete") return { replayed: true };
      throw new EvaluationError("VERSION_CONFLICT");
    },
    async finalize(raw: unknown) {
      guard(); const command = FinalizeCommandSchema.parse(raw);
      const row = await repository.evaluation(command.evaluationId); if (!row || row.campaign_id !== command.campaignId) throw new EvaluationError("NOT_FOUND", 404);
      const scenario = row.metrics_json.context.analyticsScenario;
      async function completedReplay() {
        const saved = await repository.evaluation(command.requestId); if (!saved) return false;
        const audit = saved.metrics_json.finalization;
        if (!audit || saved.campaign_id !== command.campaignId || audit.reviewedEvaluationId !== command.evaluationId || audit.actorUserId !== dependencies.ownerUserId ||
          audit.expectedCampaignVersion !== command.expectedCampaignVersion || audit.sourceContextHash !== command.expectedContextHash) throw new EvaluationError("IDEMPOTENCY_CONFLICT");
        return true;
      }
      if (await completedReplay()) return { ...await view(command.campaignId, scenario), replayed: true };
      const current = await context(command.campaignId, scenario); requireVersion(current, command.expectedCampaignVersion, command.expectedContextHash);
      evaluationHandoff(row, current.contextHash);
      const eligibility = evaluationFinalization(current, row, await repository.latestId(command.campaignId));
      if (!eligibility.eligible) throw new EvaluationError(eligibility.code ?? "EVALUATION_REJECTED");
      let replayed = false;
      try { await repository.finalize(command); }
      catch (error) { if (await completedReplay()) replayed = true; else return dependencies.databaseError(error); }
      const confirmed = await view(command.campaignId, scenario);
      if (confirmed.context.snapshot.campaign.status !== "completed" || !confirmed.history.some((entry) => entry.row.id === command.requestId && entry.row.metrics_json.finalization)) throw new EvaluationError("PERSISTENCE_UNAVAILABLE", 503);
      return { ...confirmed, replayed };
    },
  };
}
