import "server-only";
import { z } from "zod";
import { authenticateDiscussion, checkWriteOrigin } from "../campaign-strategist/discussion-auth.server";
import { discussionApiError, readDiscussionBody } from "../campaign-strategist/discussion-api.server";
import { CampaignExecutionError } from "../campaign-execution/contracts";
import { privilegedTransport } from "@/lib/supabase/transport.server";
import { AnalyticsScenarioSchema, CostCreateCommandSchema, CostReviewCommandSchema, CostVoidCommandSchema, EvaluationCommandSchema,
  EvaluationReviewCommandSchema, FinalizeCommandSchema, EvaluationError } from "./contracts";
import { evaluationDevelopmentEnabled, syntheticCampaignAnalytics } from "./development-provider";
import { evaluationRepository, evaluationDatabaseError } from "./repository.server";
import { configuredEvaluationProvider } from "./gemini.server";
import { recordEvaluationTiming } from "./performance";
import { evaluationService } from "./service";
import { GenerationClaimError } from "@/lib/ai/generation-claims.server";

async function boundary(request: Request) {
  const owner = await authenticateDiscussion(request);
  if (!evaluationDevelopmentEnabled(process.env)) throw new EvaluationError("SYNTHETIC_EVALUATION_DISABLED", 503);
  const now = () => new Date().toISOString(); const repository = evaluationRepository(owner.user, privilegedTransport, owner);
  return { repository, service: evaluationService(repository, { now, ownerUserId: owner.ownerUserId, enabled: true, databaseError: evaluationDatabaseError,
    analytics: async (facts, scenario, at) => syntheticCampaignAnalytics(facts.snapshot, scenario, at, process.env),
    provider: (scenario) => configuredEvaluationProvider(scenario, process.env) }) };
}
const respond = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
function failure(error: unknown): Response {
  if (error instanceof GenerationClaimError) return Response.json({ success: false, code: error.code }, { status: error.status, headers: { "Cache-Control": "no-store",
    ...(error.retryAfter ? { "Retry-After": String(error.retryAfter) } : {}) } });
  if (error instanceof EvaluationError || error instanceof CampaignExecutionError) return respond({ success: false, code: error.code }, error.status);
  if (error instanceof z.ZodError) return respond({ success: false, code: "INVALID_INPUT" }, 400);
  return discussionApiError(error);
}
export async function evaluationGet(request: Request) {
  const started = performance.now(); let authMs: number | null = null, status = 500;
  try {
    const authStarted = performance.now(); const bound = await boundary(request); authMs = performance.now() - authStarted; const url = new URL(request.url);
    const value = !url.searchParams.has("campaignId") ? { campaigns: await bound.repository.list(), synthetic: true }
      : await bound.service.view(z.uuid().parse(url.searchParams.get("campaignId")), AnalyticsScenarioSchema.parse(url.searchParams.get("scenario") ?? "exceeds_target"));
    const serializing = performance.now(); const response = respond(value); status = response.status;
    recordEvaluationTiming("serialization", null, performance.now() - serializing);
    return response;
  } catch (error) { const response = failure(error); status = response.status; return response; }
  finally {
    if (authMs !== null) recordEvaluationTiming("authentication", null, authMs);
    recordEvaluationTiming("total", null, performance.now() - started, status < 400);
  }
}
const ActionSchema = z.discriminatedUnion("action", [EvaluationCommandSchema.extend({ action: z.literal("generate") }), EvaluationReviewCommandSchema.extend({ action: z.literal("review") }),
  CostCreateCommandSchema.extend({ action: z.literal("create_cost") }), CostVoidCommandSchema.extend({ action: z.literal("void_cost") }), CostReviewCommandSchema.extend({ action: z.literal("review_costs") }),
  FinalizeCommandSchema.extend({ action: z.literal("finalize") })]);
export async function evaluationPost(request: Request) {
  const started = performance.now(); let requestId: string | null = null, authMs: number | null = null, status = 500;
  try {
    const authStarted = performance.now(); const bound = await boundary(request); authMs = performance.now() - authStarted;
    checkWriteOrigin(request); const { action, ...body } = ActionSchema.parse(await readDiscussionBody(request));
    requestId = "requestId" in body ? body.requestId : null;
    const value = action === "generate" ? await bound.service.generate(body) : action === "review" ? await bound.service.review(body)
      : action === "finalize" ? await bound.service.finalize(body) : action === "create_cost" ? await bound.service.createCost(body)
      : action === "void_cost" ? await bound.service.voidCost(body) : await bound.service.reviewCosts(body);
    const serializing = performance.now(); const response = respond(value); status = response.status;
    recordEvaluationTiming("serialization", requestId, performance.now() - serializing);
    return response;
  } catch (error) { const response = failure(error); status = response.status; return response; }
  finally {
    if (authMs !== null) recordEvaluationTiming("authentication", requestId, authMs);
    recordEvaluationTiming("total", requestId, performance.now() - started, status < 400);
  }
}
