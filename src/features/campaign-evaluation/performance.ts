import { z } from "zod";

type EvaluationPhase = "authentication" | "database" | "context" | "calculation" | "prompt" | "provider" | "validation" | "persistence" | "serialization" | "total";
type DatabaseOperation = "facts" | "history" | "latest" | "evaluation" | "save";
export function recordEvaluationTiming(phase: EvaluationPhase, requestId: string | null, durationMs: number, success = true, operation?: DatabaseOperation) {
  if (process.env.NODE_ENV !== "development" || process.env.GEMINI_DEBUG !== "true") return;
  console.log("[EVALUATION_PERF]", JSON.stringify({ requestId: z.uuid().safeParse(requestId).success ? requestId : null,
    phase, durationMs: Math.round(Math.max(0, durationMs) * 100) / 100, success, ...(operation ? { operation } : {}) }));
}
export async function measureEvaluation<T>(phase: EvaluationPhase, requestId: string | null, action: () => Promise<T>, operation?: DatabaseOperation): Promise<T> {
  const started = performance.now(); let success = false;
  try { const value = await action(); success = true; return value; }
  finally { recordEvaluationTiming(phase, requestId, performance.now() - started, success, operation); }
}
