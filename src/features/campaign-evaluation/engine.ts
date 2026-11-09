import { z } from "zod";
import { EvaluationNarrativeSchema, AnalysisSchema, EvaluationError, type EvaluationContext, type EvaluationProvider, type EvaluationSummary } from "./contracts";
import { measureEvaluation, recordEvaluationTiming } from "./performance";
import { evaluationAssessments } from "./calculate";
import { narrativeRejection, contradictsAssessments, type NarrativeRejection } from "@/lib/ai/narrative-safety";

type RejectionCategory = "classification_mismatch" | "unsupported_reference" | "contradictory_claim" | NarrativeRejection;
class NarrativeValidationError extends EvaluationError {
  constructor(readonly category: RejectionCategory, readonly fieldPath: string) { super("INVALID_AI_EVALUATION", 502); }
}
export function validateEvaluationNarrative(raw: unknown, context: EvaluationContext, summary: EvaluationSummary) {
  const report = EvaluationNarrativeSchema.parse(raw), states = evaluationAssessments(summary);
  for (const field of ["outcome", "financialState", "executionState"] as const) {
    if (report[field] !== states[field]) throw new NarrativeValidationError("classification_mismatch", field);
  }
  const unsupported = report.evidenceReferences.findIndex(ref => !context.references.includes(ref));
  if (unsupported !== -1) throw new NarrativeValidationError("unsupported_reference", "evidenceReferences." + unsupported);
  for (const field of ["summary", "kpiAnalysis", "financialAnalysis", "executionAnalysis", "successes", "shortfalls", "risks", "recommendations", "warnings"] as const) {
    const content = report[field], values = typeof content === "string" ? [content] : content;
    for (const [index, value] of values.entries()) {
      const rejection = narrativeRejection(value, { targetUnits: [summary.plannedAdditionalUnits], promotionBudgetIdr: [summary.budgetCapIdr],
        observedUnits: summary.observed.paidUnitsInWindow === null ? [] : [summary.observed.paidUnitsInWindow] }) ??
        (contradictsAssessments(value, states) ? "contradictory_claim" : null);
      if (rejection) throw new NarrativeValidationError(rejection, field + (typeof content === "string" ? "" : "." + index));
    }
  }
  return report;
}
function logRejection(error: unknown, stage: string, requestId: string | null) {
  if (process.env.NODE_ENV !== "development" || process.env.GEMINI_DEBUG !== "true") return;
  const issue = error instanceof z.ZodError ? error.issues[0] : undefined;
  // Schema paths can contain untrusted object keys; log only known contract fields and indexes.
  const fieldPath = issue?.path.filter(part => typeof part === "number" || typeof part === "string" &&
    (part === "narrative" || part === "providerRequestId" || Object.hasOwn(EvaluationNarrativeSchema.shape, part))).join(".") || "$";
  const providerCodes = ["INVALID_AI_EVALUATION", "INVALID_RESPONSE", "CONFIGURATION_ERROR", "PROVIDER_REFUSED", "PROVIDER_TIMEOUT", "PROVIDER_RATE_LIMITED", "MODEL_UNAVAILABLE", "PROVIDER_UNAVAILABLE", "OUTPUT_TRUNCATED"];
  const invalidJson = stage === "provider_response" && error instanceof EvaluationError && error.code === "INVALID_AI_EVALUATION";
  console.warn("Evaluation output rejected", JSON.stringify({
    stage: invalidJson ? "provider_json" : stage, category: invalidJson ? "json_invalid" : error instanceof NarrativeValidationError ? error.category : error instanceof z.ZodError ? "schema_invalid" : "provider_failure",
    code: error instanceof EvaluationError && providerCodes.includes(error.code) ? error.code : "INVALID_AI_EVALUATION",
    fieldPath: error instanceof NarrativeValidationError ? error.fieldPath : fieldPath,
    requestId: z.uuid().safeParse(requestId).success ? requestId : null,
    classificationMismatch: error instanceof NarrativeValidationError && error.category === "classification_mismatch",
    unsupportedReferences: error instanceof NarrativeValidationError && error.category === "unsupported_reference",
    issueCount: error instanceof z.ZodError ? error.issues.length : 0,
    ...(error instanceof z.ZodError ? { issueCode: issue?.code } : {}),
  }));
}
export async function interpretEvaluation(context: EvaluationContext, summary: EvaluationSummary, provider: EvaluationProvider, now = () => new Date().toISOString(), requestId: string | null = null) {
  let providerRequestId: string | null = null;
  const empty = () => ({ schemaVersion: 1, ...(provider.kind === "gemini" ? { provider: "gemini", model: provider.model, providerRequestId, generatedAt: now() }
    : { provider: "development-fake-evaluation" }), synthetic: true, narrative: null,
    review: { status: "unreviewed", reviewedByUserId: null, reviewedAt: null } });
  let raw: unknown;
  try { raw = await measureEvaluation("provider", requestId, () => provider.generate({ summary, references: context.references }, { requestId })); }
  catch (error) {
    logRejection(error, "provider_response", requestId);
    return AnalysisSchema.parse({ ...empty(), status: error instanceof EvaluationError && ["INVALID_AI_EVALUATION", "INVALID_RESPONSE"].includes(error.code) ? "invalid" : "failed" });
  }
  const validationStarted = performance.now(); let validated = false;
  let stage = provider.kind === "gemini" ? "provider_envelope" : "narrative_schema";
  try {
    if (provider.kind === "gemini") {
      const result = z.strictObject({ narrative: z.unknown(), providerRequestId: z.string().min(1).max(256).nullable() }).parse(raw);
      providerRequestId = result.providerRequestId; raw = result.narrative;
    }
    stage = "narrative_schema";
    const narrative = validateEvaluationNarrative(raw, context, summary);
    const analysis = AnalysisSchema.parse({ ...empty(), status: "available", narrative }); validated = true; return analysis;
  } catch (error) {
    logRejection(error, error instanceof NarrativeValidationError ? "narrative_domain" : stage, requestId);
    return AnalysisSchema.parse({ ...empty(), status: "invalid" });
  } finally { recordEvaluationTiming("validation", requestId, performance.now() - validationStarted, validated); }
}
