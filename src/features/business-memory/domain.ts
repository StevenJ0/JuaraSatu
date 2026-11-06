import { fingerprint } from "../campaign-blueprint";
import { z } from "zod";
import { evaluationHandoff, type EvaluationRow } from "../campaign-evaluation";
import { MemoryError, MemorySourceSchema, MemoryInterpretationSchema, MemoryRowSchema, type MemorySource, type MemoryRow, type MemoryProvider,type MemoryJob } from "./contracts";
import { narrativeRejection, normalizeNarrative, contradictsAssessments } from "@/lib/ai/narrative-safety";

export function memorySource(row: EvaluationRow, currentHash: string): MemorySource {
  const h = evaluationHandoff(row, currentHash); const b = h.strategy; const audit = h.completion;
  if (!h.developmentEligible || !audit || !b || row.evaluation_kind !== "final") throw new MemoryError("ELIGIBLE_COMPLETED_EVALUATION_REQUIRED");
  return MemorySourceSchema.parse({ businessId: h.businessId, campaignId: h.campaignId, preorderId: h.preorderId, evaluationId: h.evaluationId,
    blueprintId: h.blueprintId, sourceVersion: audit.completedCampaignVersion, contextHash: h.contextHash, sourceFactsAt: h.sourceFactsAt,
    synthetic: true, productionEligible: h.productionEligible, developmentEligible: h.developmentEligible, objective: b.goal.replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi,"[contact removed]").replace(/(?:\+?\d[\d ()-]{7,}\d)/g,"[contact removed]").replace(/\b(?:Bearer\s+\S+|(?:api[_ -]?key|token|secret|password)\s*[:=]\s*\S+)/gi,"[credential removed]"),
    strategy: { marketingApproach: b.marketingApproach, offerType: b.offer.type, discountBps: b.offer.discountBps, startsAt: row.metrics_json.context.snapshot.campaign.starts_at, endsAt: row.metrics_json.context.snapshot.campaign.ends_at },
    results: h.results, sourceVersions: h.sourceVersions, limitations: h.limitations });
}
export function memoryAssessments(s: MemorySource) {
  return { outcome: s.results.achievementBps === null ? "unknown" as const : s.results.achievementBps >= 10000 ? "above_target" as const : "below_target" as const,
    financialState: s.results.contributionIdr === null ? "unknown" as const : s.results.contributionIdr > 0 ? "positive" as const : "nonpositive" as const,
    executionState: s.results.executionBps === 10000 ? "complete" as const : "incomplete" as const };
}
function memoryInterpretation(raw: unknown, source: MemorySource, checkExternalExecution: boolean) {
  const output = MemoryInterpretationSchema.parse(raw); const states = memoryAssessments(source);
  if (output.businessId !== source.businessId || output.campaignId !== source.campaignId || output.sourceEvaluationId !== source.evaluationId || output.sourceVersion !== source.sourceVersion ||
    output.outcome !== states.outcome || output.financialState !== states.financialState || output.executionState !== states.executionState) throw new MemoryError("MEMORY_SOURCE_MISMATCH", 502);
  const texts = [output.summary, ...output.lessons, ...output.risks, ...output.recommendations];
  if (texts.some(value => narrativeRejection(value, { targetUnits: [source.results.plannedAdditionalUnits], promotionBudgetIdr: [source.results.budgetCapIdr],
    observedUnits: source.results.observed.paidUnitsInWindow === null ? [] : [source.results.observed.paidUnitsInWindow] }, checkExternalExecution) || contradictsAssessments(value, states) ||
    /[\w.+-]+@[\w.-]+\.[a-z]{2,}|\b(?:abaikan|ignore|system|instruction|instruksi|token|secret|password)\b/iu.test(normalizeNarrative(value)))) throw new MemoryError("UNSAFE_MEMORY_TEXT", 502);
  if (output.evidenceReferences.includes("c6") && source.results.observed.paidUnitsInWindow === null) throw new MemoryError("INCOMPLETE_MEMORY_EVIDENCE", 502);
  return output;
}
export function validateMemoryInterpretation(raw: unknown, source: MemorySource) {
  return memoryInterpretation(raw, source, true);
}
export function memoryContentHash(row: Pick<MemoryRow, "summary_text" | "lessons_json" | "limitations_json">) {
  return fingerprint({ summary: row.summary_text, payload: row.lessons_json, limitations: row.limitations_json });
}
export function memoryJobMatches(job:MemoryJob,row:MemoryRow) {
  try { const raw:unknown=JSON.parse(job.dedupe_key);const key=z.tuple([z.uuid(),z.number().int().positive(),z.string().regex(/^[a-f0-9]{64}$/),z.string().min(1).max(128),z.string().min(1).max(128)]).parse(raw);
    return job.entity_id===row.id&&job.business_id===row.business_id&&JSON.stringify(key)===JSON.stringify([row.id,row.embedding_version,row.content_hash,row.embedding_model,row.embedding_profile]);
  }catch{return false;}
}
export function validateStoredMemory(raw: unknown) {
  const row = MemoryRowSchema.parse(raw); const s = row.lessons_json.source;
  if (row.business_id !== s.businessId || row.campaign_id !== s.campaignId || row.source_evaluation_id !== s.evaluationId ||
    row.source_blueprint_id !== s.blueprintId || row.source_version !== s.sourceVersion || row.content_hash !== memoryContentHash(row) ||
    row.summary_text !== row.lessons_json.interpretation.summary || fingerprint(row.limitations_json) !== fingerprint(s.limitations)) throw new MemoryError("INVALID_MEMORY_SNAPSHOT");
  // Historical wording remains readable; new candidate generation additionally rejects unverified execution.
  memoryInterpretation(row.lessons_json.interpretation, s, false); return row;
}
export async function generateMemoryInterpretation(source: MemorySource, provider: MemoryProvider, now = () => new Date().toISOString()) {
  let raw: unknown;
  try { raw = await provider.generate(MemorySourceSchema.parse(source)); }
  catch (error) { if (error instanceof MemoryError && error.code === "INVALID_MEMORY_OUTPUT") throw error; throw new MemoryError("MEMORY_PROVIDER_UNAVAILABLE", 503); }
  try {
    if (provider.kind === "gemini") {
      const result = z.strictObject({ interpretation: MemoryInterpretationSchema, providerRequestId: z.string().min(1).max(256).nullable() }).parse(raw);
      return { interpretation: validateMemoryInterpretation(result.interpretation, source), provider: "gemini", model: provider.model, providerRequestId: result.providerRequestId, generatedAt: now() };
    }
    return { interpretation: validateMemoryInterpretation(raw, source), provider: "development-fake-memory" };
  }
  catch (error) { if (error instanceof MemoryError) throw error; throw new MemoryError("INVALID_MEMORY_OUTPUT", 502); }
}
export function memoryApproval(row: MemoryRow, current: MemorySource | null) {
  const blockers: string[] = [];
  if (!current || fingerprint(current) !== fingerprint(row.lessons_json.source)) blockers.push("STALE_MEMORY_SOURCE");
  if (row.lessons_json.source.synthetic || !row.lessons_json.source.productionEligible) blockers.push("SYNTHETIC_MEMORY_APPROVAL_FORBIDDEN");
  if (row.lessons_json.ownerReview.decision !== "reviewed") blockers.push("MEMORY_OWNER_REVIEW_REQUIRED");
  return { eligible: blockers.length === 0, blockers };
}
