import "server-only";
import { createGeminiDebugTrace, type GeminiDebugStage, type GeminiDebugTrace } from "@/lib/ai/gemini-debug.server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { buildBusinessContext, type CampaignContextV1 } from "../ai-context";
import { GenerationClaimError } from "@/lib/ai/generation-claims.server";
import { privilegedTransport, SupabaseError } from "@/lib/supabase/transport.server";
import { authenticateDiscussion, checkWriteOrigin, DiscussionHttpError, ownedPreorder, ownedSession } from "./discussion-auth.server";
import { seededDevelopmentContext } from "./development-context.server";
import { configuredDiscussionProvider, discussionProviderIdentity } from "./configured-provider.server";
import { createSupabaseDiscussionRepository } from "./supabase-discussion-repository.server";
import { sendPersistentDiscussion } from "./persistent-discussion-service";
import { SendDiscussionSchema } from "./persistence-contracts";
import type { DevelopmentScenario } from "./persistence-contracts";

export async function readDiscussionBody(request: Request, maxBytes = 16384): Promise<unknown> {
  if (Number(request.headers.get("content-length") ?? 0) > maxBytes) throw new DiscussionHttpError(400, "INVALID_INPUT");
  const reader = request.body?.getReader(); if (!reader) throw new DiscussionHttpError(400, "INVALID_INPUT");
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const part = await reader.read(); if (part.done) break;
      size += part.value.length;
      if (size > maxBytes) { await reader.cancel(); throw new DiscussionHttpError(400, "INVALID_INPUT"); }
      chunks.push(part.value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes)); return value;
  } catch (error) { if (error instanceof DiscussionHttpError) throw error; throw new DiscussionHttpError(400, "INVALID_INPUT"); }
}
export function discussionApiError(error: unknown): Response {
  let status = 503; let code = "PERSISTENCE_UNAVAILABLE";
  if (error instanceof DiscussionHttpError) { status = error.status; code = error.code; }
  else if (error instanceof GenerationClaimError) { status = error.status; code = error.code; }
  else if (error instanceof z.ZodError) { status = 400; code = "INVALID_INPUT"; }
  else if (error instanceof SupabaseError && [400, 401, 403].includes(error.status)) { status = 401; code = "UNAUTHENTICATED"; }
  return Response.json({ success: false, code }, { status, headers: { "Cache-Control": "no-store",
    ...(error instanceof GenerationClaimError && error.retryAfter ? { "Retry-After": String(error.retryAfter) } : {}) } });
}
function requireResult<T>(result: { success: true; data: T } | { success: false; code: string }): T {
  if (result.success) return result.data;
  throw new DiscussionHttpError(errorStatus(result.code), result.code);
}
function errorStatus(code: string) {
  if (["VERSION_CONFLICT", "STALE_CONTEXT", "IDEMPOTENCY_CONFLICT", "TURN_IN_PROGRESS"].includes(code)) return 409;
  if (code === "NOT_FOUND") return 404;
  if (code === "FORBIDDEN") return 403;
  if (code === "INVALID_INPUT") return 400;
  if (code === "PROVIDER_TIMEOUT") return 504;
  if (code === "PROVIDER_RATE_LIMITED") return 429;
  if (["INVALID_RESPONSE", "UNSAFE_TEXT"].includes(code)) return 502;
  return 503;
}
const ActionSchema = z.discriminatedUnion("action", [
  SendDiscussionSchema.extend({ action: z.literal("send") }),
  z.strictObject({ action: z.literal("create"), preorderId: z.uuid(), sessionId: z.uuid().optional() }),
  z.strictObject({ action: z.literal("refresh"), sessionId: z.uuid(), expectedVersion: z.number().int().positive() }),
  z.strictObject({ action: z.literal("recover"), sessionId: z.uuid(), generationId: z.uuid(), expectedVersion: z.number().int().positive() }),
]);
async function developmentBoundary(request: Request) {
  const owner = await authenticateDiscussion(request); const identity = discussionProviderIdentity(process.env);
  const now = () => new Date().toISOString();
  return { owner, identity, now, ownerMode: false, syntheticContext: true, checkOrigin: checkWriteOrigin,
    repository: createSupabaseDiscussionRepository(owner.user, privilegedTransport, identity.model),
    loadContext: seededDevelopmentContext(owner.user, process.env, now),
    provider: (scenario: DevelopmentScenario, debug?: GeminiDebugTrace) => configuredDiscussionProvider(scenario, process.env, debug),
    campaigns: async (): Promise<Array<{ id: string; name: string; preorderId: string; sessionId: string }>> => [] };
}
export function createDiscussionHandlers(boundary: typeof developmentBoundary) {
  return { GET: (request: Request) => discussionGetFor(request, boundary), POST: (request: Request) => discussionPostFor(request, boundary) };
}
export function discussionGet(request: Request) { return discussionGetFor(request, developmentBoundary); }
export function discussionPost(request: Request) { return discussionPostFor(request, developmentBoundary); }
async function discussionGetFor(request: Request, boundary: typeof developmentBoundary) {
  try {
    const bound = await boundary(request); const { owner, identity, repository } = bound;
    const url = new URL(request.url);
    if (url.searchParams.has("sessionId")) {
      const scope = await ownedSession(owner, z.uuid().parse(url.searchParams.get("sessionId")));
      const session = requireResult(await repository.view(scope));
      let currentHash: string | null = null;
      let historicalMemory:CampaignContextV1["history"]={status:"unavailable",reason:"read_failed",memories:[]};
      try {
        const context = buildBusinessContext(await bound.loadContext(scope));
        if (context.success) {currentHash = context.data.contextHash;historicalMemory=context.data.history;}
      } catch { /* A persisted discussion remains readable while production sources are unavailable. */ }
      return Response.json({ session, currentHash, historicalMemory, syntheticContext: bound.syntheticContext, ...identity }, { headers: { "Cache-Control": "no-store" } });
    }
    const preorders = z.array(z.object({ id: z.uuid(), name: z.string(), status: z.string() })).parse(await owner.user.select("preorders", {
      select: "id,name,status", business_id: `eq.${owner.businessId}`,
      ...(bound.ownerMode ? { status: "eq.published", starts_at: `lte.${bound.now()}`, ends_at: `gt.${bound.now()}` } : {}),
      order: "created_at.desc", limit: "100" }));
    const sessions = z.array(z.object({ id: z.uuid(), preorder_id: z.uuid(), status: z.string(), updated_at: z.string() })).parse(await owner.user.select("campaign_ai_sessions", {
      select: "id,preorder_id,status,updated_at", business_id: `eq.${owner.businessId}`, status: "eq.active", order: "updated_at.desc", limit: "100" }));
    return Response.json({ preorders, sessions, campaigns: await bound.campaigns(), ...identity, syntheticContext: bound.syntheticContext }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return discussionApiError(error); }
}
async function discussionPostFor(request: Request, boundary: typeof developmentBoundary) {
  const debug = createGeminiDebugTrace();
  let stage: GeminiDebugStage = "API_REQUEST";
  let finalStatus = 200, finalCode = "COMPLETED";
  let debugInput: unknown;
  debug.event(stage, "STARTED", { route: "POST /api/dev/discussions" });
  try {
    const bound = await boundary(request); const { owner, identity, repository, now, loadContext } = bound;
    bound.checkOrigin(request);
    stage = "INPUT_VALIDATION";
    debugInput = await readDiscussionBody(request);
    const action = ActionSchema.parse(debugInput);
    if (bound.ownerMode && action.action === "send" && action.scenario !== "normal") throw new DiscussionHttpError(400, "FAKE_SCENARIO_DISABLED");
    debug.event(stage, "SUCCESS", { action: action.action, sessionId: "sessionId" in action ? action.sessionId : undefined, inputValidated: true });
    stage = "PROVIDER_CONFIGURATION";
    debug.event(stage, "STARTED", { apiKeyConfigured: !!process.env.GEMINI_API_KEY?.trim() });
    debug.event(stage, "SUCCESS", { model: identity.model, provider: identity.provider, sdk: "@google/genai" });
    stage = "PERSISTENCE";
    if (action.action === "create") {
      await ownedPreorder(owner.user, owner.businessId, action.preorderId);
      const scope = { businessId: owner.businessId, preorderId: action.preorderId, ownerUserId: owner.ownerUserId, sessionId: action.sessionId ?? randomUUID() };
      let context: ReturnType<typeof buildBusinessContext>;
      try { context = buildBusinessContext(await loadContext(scope)); } catch { throw new DiscussionHttpError(503, "CONTEXT_UNAVAILABLE"); }
      if (!context.success) throw new DiscussionHttpError(503, "CONTEXT_UNAVAILABLE");
      if (bound.ownerMode && (!context.data.preorder.isOrderIntakeOpen || !context.data.preorder.orderableUnits)) {
        throw new DiscussionHttpError(409, "NO_FEASIBLE_OPTIONS");
      }
      requireResult(await repository.create(scope, context.data.contextHash));
      return Response.json({ session: requireResult(await repository.view(scope)) });
    }
    const scope = await ownedSession(owner, action.sessionId);
    if (action.action === "send") {
      const { action: operation, ...command } = action; void operation;
      stage = "PROVIDER_CONFIGURATION";
      const provider = bound.provider(command.scenario, debug);
      stage = "PERSISTENCE";
      const outcome = await sendPersistentDiscussion(scope, command, repository, { provider, loadContext, now, debug });
      finalStatus = !outcome.success ? errorStatus(outcome.code) : outcome.status === "running" ? 202 : 200;
      finalCode = !outcome.success ? outcome.code : outcome.status === "running" ? "RUNNING" : "COMPLETED";
      return Response.json(outcome, { status: finalStatus,
        headers: { "Cache-Control": "no-store" } });
    }
    if (action.action === "refresh") {
      let context: ReturnType<typeof buildBusinessContext>;
      try { context = buildBusinessContext(await loadContext(scope)); } catch { throw new DiscussionHttpError(503, "CONTEXT_UNAVAILABLE"); }
      if (!context.success) throw new DiscussionHttpError(503, "CONTEXT_UNAVAILABLE");
      requireResult(await repository.refresh(scope, action.expectedVersion, context.data.contextHash));
    } else {
      const view = requireResult(await repository.view(scope));
      const generation = view.generations.find((row) => row.id === action.generationId && row.status === "running");
      if (view.version !== action.expectedVersion) throw new DiscussionHttpError(409, "VERSION_CONFLICT");
      if (!generation || !generation.started_at || Date.now() - Date.parse(generation.started_at) < 120000) throw new DiscussionHttpError(409, "TURN_IN_PROGRESS");
      requireResult(await repository.failTurn({ scope, generationId: generation.id, claimVersion: view.version, errorCode: "PROVIDER_TIMEOUT" }));
    }
    return Response.json({ session: requireResult(await repository.view(scope)) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const response = discussionApiError(error);
    finalStatus = response.status;
    if (debug.enabled) {
      const body = z.object({ code: z.string() }).parse(await response.clone().json());
      finalCode = body.code;
      if (error instanceof z.ZodError) debug.issues(stage, error, debugInput);
      debug.event(stage, "FAILED", { code: body.code, error });
    }
    return response;
  } finally { debug.end(finalStatus, finalCode); }
}
