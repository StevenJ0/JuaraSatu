import "server-only";
import { z } from "zod";
import { SupabaseError, type SupabaseTransport } from "@/lib/supabase/transport.server";
import { GenerationClaimError } from "@/lib/ai/generation-claims.server";
import { generationQuotaPolicy } from "@/lib/ai/generation-quota-policy.server";
import type { DiscussionSession as SessionType } from "./discussion-repository";
import type { DiscussionRepository, DiscussionScope, RepositoryError, RepositoryResult } from "./discussion-repository";
import { StrategyProposalSchema, summarizeProposals, type StrategyErrorCode } from "./contracts";
import { GenerationSchema, type DiscussionView } from "./persistence-contracts";

const SessionSchema = z.object({ id: z.uuid(), business_id: z.uuid(), preorder_id: z.uuid(), version: z.number().int().positive(),
  context_version_hash: z.string().regex(/^[a-f0-9]{64}$/), status: z.enum(["active", "closed"]) });
const MessageSchema = z.object({ id: z.uuid(), sequence: z.number().int().positive(), role: z.enum(["user", "assistant"]),
  body_text: z.string().min(1).max(4000), context_hash: z.string().regex(/^[a-f0-9]{64}$/), proposal_json: StrategyProposalSchema.nullable() });
const ClaimSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("claimed"), generationId: z.uuid(), claimVersion: z.number().int().positive() }),
  z.object({ status: z.literal("running"), generationId: z.uuid() }),
  z.object({ status: z.literal("success"), generationId: z.uuid(), output: StrategyProposalSchema }),
  z.object({ status: z.enum(["failed", "invalid_output"]), generationId: z.uuid(), errorCode: z.string().nullable() }),
]);
const FinalizedSchema = z.object({ status: z.literal("success"), generationId: z.uuid(), sessionVersion: z.number().int().positive() });
const FailedSchema = z.object({ status: z.literal("failed"), sessionVersion: z.number().int().positive() });
const failureCodes = new Set<StrategyErrorCode>(["CONFIGURATION_ERROR", "PROVIDER_REFUSED", "PROVIDER_TIMEOUT", "PROVIDER_RATE_LIMITED",
  "MODEL_UNAVAILABLE", "PROVIDER_UNAVAILABLE", "INVALID_RESPONSE", "OUTPUT_TRUNCATED", "INVALID_INPUT", "CONTEXT_UNAVAILABLE", "STALE_CONTEXT", "UNSAFE_TEXT", "NO_FEASIBLE_OPTIONS"]);
function failureCode(code: string | null): StrategyErrorCode {
  for (const known of failureCodes) if (known === code) return known;
  return "PROVIDER_UNAVAILABLE";
}
export function repositoryError(error: unknown): RepositoryError {
  if (!(error instanceof SupabaseError)) return "PERSISTENCE_UNAVAILABLE";
  if (error.code === "40001") {
    if (error.detail === "VERSION_CONFLICT") return "VERSION_CONFLICT";
    if (error.detail === "IDEMPOTENCY_CONFLICT") return "IDEMPOTENCY_CONFLICT";
    if (error.detail === "STALE_CONTEXT") return "STALE_CONTEXT";
    if (error.detail === "TURN_IN_PROGRESS") return "TURN_IN_PROGRESS";
  }
  if (error.code === "42501") return "FORBIDDEN";
  if (error.code === "P0002" || error.code === "23503") return "NOT_FOUND";
  return "PERSISTENCE_UNAVAILABLE";
}
async function result<T>(work: () => Promise<T>): Promise<RepositoryResult<T>> {
  try { return { success: true, data: await work() }; }
  catch (error) { if (error instanceof GenerationClaimError) throw error; return { success: false, code: repositoryError(error) }; }
}
export function createSupabaseDiscussionRepository(user: SupabaseTransport, privileged: () => SupabaseTransport, modelId: string) {
  async function readSession(scope: DiscussionScope) {
    const rows = z.array(SessionSchema).parse(await user.select("campaign_ai_sessions", {
      select: "id,business_id,preorder_id,version,context_version_hash,status", id: `eq.${scope.sessionId}`,
      business_id: `eq.${scope.businessId}`, preorder_id: `eq.${scope.preorderId}`, limit: "1" }));
    if (!rows[0]) throw new SupabaseError("P0002", "NOT_FOUND", 404);
    return rows[0];
  }
  async function view(scope: DiscussionScope): Promise<RepositoryResult<DiscussionView>> {
    return result(async () => {
      for (let attempt = 0; attempt < 2; attempt++) {
        const before = await readSession(scope);
        const [rawMessages, rawGenerations] = await Promise.all([
          user.select("campaign_ai_messages", { select: "id,sequence,role,body_text,context_hash,proposal_json",
            session_id: `eq.${scope.sessionId}`, business_id: `eq.${scope.businessId}`, order: "sequence.desc", limit: "200" }),
          user.select("ai_generations", { select: "id,status,started_at,error_code,request_key", session_id: `eq.${scope.sessionId}`,
            business_id: `eq.${scope.businessId}`, order: "created_at.desc", limit: "200" }),
        ]);
        const after = await readSession(scope);
        if (before.version !== after.version) continue;
        const rows = z.array(MessageSchema).parse(rawMessages).reverse();
        for (const message of rows) if (message.proposal_json && (message.proposal_json.sessionId !== scope.sessionId ||
          message.proposal_json.businessId !== scope.businessId || message.proposal_json.preorderId !== scope.preorderId)) {
          throw new SupabaseError("PERSISTENCE_UNAVAILABLE", "INVALID_PROPOSAL_SCOPE", 503);
        }
        return { id: after.id, businessId: after.business_id, preorderId: after.preorder_id, version: after.version,
          contextHash: after.context_version_hash, status: after.status, truncated: rows.length === 200,
          messages: rows.map((row) => ({ id: row.id, sequence: row.sequence, role: row.role, content: row.body_text,
            contextHash: row.context_hash, proposal: row.proposal_json })), generations: z.array(GenerationSchema).parse(rawGenerations) };
      }
      throw new SupabaseError("40001", "VERSION_CONFLICT", 409);
    });
  }
  const repository: DiscussionRepository = {
    async load(scope) {
      const loaded = await view(scope);
      if (!loaded.success) return loaded;
      const data: SessionType = { ...loaded.data, messages: loaded.data.messages.map(({ sequence, role, content, contextHash }) => ({ sequence, role, content, contextHash })),
        previousProposals: summarizeProposals(loaded.data.messages.flatMap((message) => message.proposal ? [message.proposal] : [])) };
      return { success: true, data };
    },
    beginTurn: (command) => result(async () => {
      const args = { p_business_id: command.scope.businessId,
        p_session_id: command.scope.sessionId, p_expected_version: command.expectedVersion, p_context_hash: command.contextHash,
        p_request_key: command.requestKey, p_input_hash: command.inputHash, p_model_id: modelId, p_message: command.message,
        p_generation_type: "discussion", p_actor_user_id: command.scope.ownerUserId };
      const prior = z.array(z.object({ id: z.uuid() })).max(1).parse(await user.select("ai_generations", {
        select: "id", business_id: `eq.${command.scope.businessId}`, generation_type: "eq.discussion",
        request_key: `eq.${command.requestKey}`, limit: "1" }));
      let raw: unknown;
      if (prior[0]) raw = await user.rpc("claim_ai_generation", args);
      else {
        const policy = generationQuotaPolicy({ AI_DAILY_GENERATION_LIMIT: process.env.AI_DAILY_GENERATION_LIMIT,
          RATE_LIMIT_HMAC_KEY: process.env.RATE_LIMIT_HMAC_KEY });
        if (!policy.success) throw new GenerationClaimError(policy.code, 503);
        const [minute, hour, day] = policy.windows(command.scope.businessId, new Date().toISOString());
        if (!minute || !hour || !day) throw new GenerationClaimError("AI_QUOTA_CONFIGURATION_REQUIRED", 503);
        raw = await privileged().rpc("admit_ai_generation", { ...args, p_generation_id: null, p_preorder_id: null,
          p_minute_key_hash: minute.keyHash, p_hour_key_hash: hour.keyHash, p_day_key_hash: day.keyHash, p_daily_limit: policy.dailyLimit });
      }
      const denied = z.object({ status: z.literal("denied"), window: z.enum(["minute", "hour", "day"]), retryAfter: z.number().int().positive() }).safeParse(raw);
      if (denied.success) throw new GenerationClaimError("AI_RATE_LIMIT_EXCEEDED", 429, denied.data.retryAfter);
      const claim = ClaimSchema.parse(raw);
      if (claim.status === "success") {
        if (claim.output.sessionId !== command.scope.sessionId || claim.output.businessId !== command.scope.businessId ||
          claim.output.preorderId !== command.scope.preorderId || claim.output.requestKey !== command.requestKey ||
          claim.output.contextHash !== command.contextHash) throw new Error("Invalid persisted proposal");
        return { status: "completed" as const, generationId: claim.generationId, proposal: claim.output };
      }
      if (claim.status === "failed" || claim.status === "invalid_output") return { status: "failed" as const, generationId: claim.generationId, errorCode: failureCode(claim.errorCode) };
      if (claim.status === "claimed" || claim.status === "running") return claim;
      throw new Error("Invalid generation status");
    }),
    async completeTurn(command) {
      const parsed = StrategyProposalSchema.safeParse(command.proposal);
      if (!parsed.success) return { success: false, code: "PERSISTENCE_UNAVAILABLE" };
      const saved = await result(async () => { await readSession(command.scope); const finalized = FinalizedSchema.parse(await privileged().rpc("finalize_ai_generation", { p_business_id: command.scope.businessId,
        p_session_id: command.scope.sessionId, p_generation_id: command.generationId, p_claim_version: command.claimVersion,
        p_output_json: parsed.data, p_actor_user_id: command.scope.ownerUserId }));
        if (finalized.generationId !== command.generationId) throw new Error("Invalid finalization binding");
        return finalized; });
      return saved.success ? repository.load(command.scope) : saved;
    },
    async failTurn(command) {
      const saved = await result(async () => { await readSession(command.scope); return FailedSchema.parse(await privileged().rpc("fail_ai_generation", { p_business_id: command.scope.businessId,
        p_session_id: command.scope.sessionId, p_generation_id: command.generationId, p_claim_version: command.claimVersion,
        p_error_code: command.errorCode, p_actor_user_id: command.scope.ownerUserId })); });
      return saved.success ? repository.load(command.scope) : saved;
    },
  };
  return { ...repository, view,
    create: (scope: DiscussionScope, contextHash: string) => result(async () => SessionSchema.parse(await user.rpc("create_ai_session", {
      p_business_id: scope.businessId, p_preorder_id: scope.preorderId, p_session_id: scope.sessionId, p_context_hash: contextHash }))),
    refresh: (scope: DiscussionScope, version: number, contextHash: string) => result(async () => SessionSchema.parse(await user.rpc("refresh_ai_session_context", {
      p_business_id: scope.businessId, p_session_id: scope.sessionId, p_expected_version: version, p_context_hash: contextHash }))),
  };
}
