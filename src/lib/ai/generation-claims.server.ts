import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { SupabaseError, type SupabaseTransport } from "@/lib/supabase/transport.server";
import { generationQuotaPolicy } from "./generation-quota-policy.server";

const MemoryKey = z.string().max(128).regex(/^memory:[a-f0-9-]{36}:[1-9]\d{0,9}$/)
  .refine(key => z.uuid().safeParse(key.split(":")[1]).success && Number(key.split(":")[2]) <= 2_147_483_647);
const RequestIdentity = z.strictObject({ type: z.enum(["blueprint", "evaluation"]), requestKey: z.uuid(), inputHash: z.string().regex(/^[a-f0-9]{64}$/),
  preorderId: z.uuid(), model: z.string().min(1).max(128) });
const Identity = z.discriminatedUnion("type", [RequestIdentity, RequestIdentity.extend({ type: z.literal("memory"), requestKey: MemoryKey })]);
const Failure = z.object({ code: z.string().regex(/^[A-Z_]{1,64}$/), status: z.number().int().min(400).max(599) });
const Checkpoint = z.discriminatedUnion("kind", [z.object({ kind: z.literal("output"), value: z.unknown() }),
  z.object({ kind: z.literal("error"), error: Failure })]);
const Row = z.object({ id: z.uuid(), business_id: z.uuid(), preorder_id: z.uuid(), campaign_id: z.null(), session_id: z.null(),
  generation_type: z.enum(["blueprint", "evaluation", "memory"]), request_key: z.union([z.uuid(), MemoryKey]), input_hash: RequestIdentity.shape.inputHash, model_id: z.string(),
  status: z.enum(["running", "success", "failed", "invalid_output"]), output_json: Checkpoint.nullable(),
  started_at: z.iso.datetime({ offset: true }), finished_at: z.string().nullable(), error_code: z.string().nullable() })
  .refine(row => row.status !== "running" || row.output_json === null && row.finished_at === null, "Running claims cannot have completed output")
  .refine(row => row.status !== "success" || row.output_json?.kind === "output" && row.finished_at !== null, "Successful claims require a checkpoint");
// Beyond the maximum 120s text-provider budget and 12s storage requests; expiry never grants another inference.
const STALE_AFTER_MS = 180_000;
export class GenerationClaimError extends Error {
  constructor(readonly code: string, readonly status = 409, readonly retryAfter?: number) { super(code); }
}

const Admission = z.discriminatedUnion("status", [
  z.object({ status: z.literal("claimed"), generationId: z.uuid() }),
  z.object({ status: z.literal("denied"), window: z.enum(["minute", "hour", "day"]), retryAfter: z.number().int().positive() }),
  z.object({ status: z.enum(["running", "success", "failed", "invalid_output"]), generationId: z.uuid() }),
]);
export function generationClaims(user: SupabaseTransport, privileged: () => SupabaseTransport, businessId: string, now: () => string,
  ownerUserId: string, env: { AI_DAILY_GENERATION_LIMIT?: string; RATE_LIMIT_HMAC_KEY?: string } = {
    AI_DAILY_GENERATION_LIMIT: process.env.AI_DAILY_GENERATION_LIMIT, RATE_LIMIT_HMAC_KEY: process.env.RATE_LIMIT_HMAC_KEY }) {
  return { async run<T extends Record<string, unknown>>(raw: unknown, schema: z.ZodType<T>, generate: () => Promise<unknown>): Promise<T> {
    const identity = Identity.parse(raw); z.uuid().parse(businessId);
    if (await user.rpc("is_business_owner", { target_business_id: businessId }) !== true) throw new GenerationClaimError("FORBIDDEN", 403);
    const key = { business_id: `eq.${businessId}`, generation_type: `eq.${identity.type}`, request_key: `eq.${identity.requestKey}` };
    function validate(value: unknown) {
      const row = Row.parse(value);
      if (row.business_id !== businessId || row.generation_type !== identity.type || row.request_key !== identity.requestKey ||
        row.preorder_id !== identity.preorderId || row.input_hash !== identity.inputHash) throw new GenerationClaimError("IDEMPOTENCY_CONFLICT");
      return row;
    }
    async function read() {
      const rows = z.array(Row).max(1).parse(await user.select("ai_generations", { select: Object.keys(Row.shape).join(","), ...key, limit: "1" }));
      return rows[0] ? validate(rows[0]) : null;
    }
    function replay(row: z.infer<typeof Row>): T {
      if (row.output_json?.kind === "output") return schema.parse(row.output_json.value);
      if (row.output_json?.kind === "error") throw new GenerationClaimError(row.output_json.error.code, row.output_json.error.status);
      throw new GenerationClaimError(row.status === "running" ? "GENERATION_IN_PROGRESS" : "GENERATION_INTERRUPTED");
    }
    async function resume(row: z.infer<typeof Row>): Promise<T> {
      if (row.status === "running" && Date.parse(now()) - Date.parse(row.started_at) >= STALE_AFTER_MS) {
        await privileged().update("ai_generations", { ...key, id: `eq.${row.id}`, status: "eq.running", started_at: `eq.${row.started_at}` },
          { status: "failed", error_code: "GENERATION_INTERRUPTED", finished_at: now() });
        const latest = await read(); if (!latest) throw new GenerationClaimError("PERSISTENCE_UNAVAILABLE", 503);
        return replay(latest);
      }
      return replay(row);
    }
    const prior = await read(); if (prior) return resume(prior);
    const id = randomUUID();
    const policy = generationQuotaPolicy(env);
    if (!policy.success) throw new GenerationClaimError(policy.code, 503);
    const [minute, hour, day] = policy.windows(businessId, now());
    if (!minute || !hour || !day) throw new GenerationClaimError("AI_QUOTA_CONFIGURATION_REQUIRED", 503);
    let admission: z.infer<typeof Admission>;
    try {
      admission = Admission.parse(await privileged().rpc("admit_ai_generation", { p_business_id: businessId,
        p_actor_user_id: ownerUserId, p_generation_id: id, p_generation_type: identity.type, p_request_key: identity.requestKey,
        p_input_hash: identity.inputHash, p_model_id: identity.model, p_preorder_id: identity.preorderId,
        p_session_id: null, p_expected_version: null, p_context_hash: null, p_message: null,
        p_minute_key_hash: minute.keyHash, p_hour_key_hash: hour.keyHash, p_day_key_hash: day.keyHash, p_daily_limit: policy.dailyLimit }));
    } catch (error) {
      // A committed admission with a lost response does not grant this caller permission to infer.
      const saved = await read(); if (saved) return resume(saved);
      if (error instanceof SupabaseError && error.code === "40001" && error.detail === "IDEMPOTENCY_CONFLICT") throw new GenerationClaimError("IDEMPOTENCY_CONFLICT");
      throw error;
    }
    if (admission.status === "denied") throw new GenerationClaimError("AI_RATE_LIMIT_EXCEEDED", 429, admission.retryAfter);
    if (admission.status !== "claimed") {
      const saved = await read(); if (saved) return resume(saved);
      throw new GenerationClaimError("PERSISTENCE_UNAVAILABLE", 503);
    }
    if (admission.generationId !== id) throw new GenerationClaimError("PERSISTENCE_UNAVAILABLE", 503);
    let output: T;
    try { output = schema.parse(await generate()); }
    catch (error) {
      const parsed = Failure.safeParse(error);
      const safe = parsed.success ? parsed.data : { code: "PROVIDER_UNAVAILABLE", status: 503 };
      await privileged().update("ai_generations", { ...key, id: `eq.${id}`, status: "eq.running" },
        { status: "failed", error_code: safe.code, finished_at: now(), output_json: { kind: "error", error: safe } });
      throw error;
    }
    // Checkpoint before domain persistence: a lost save response can replay validated output without another provider call.
    const checkpoint = Checkpoint.parse({ kind: "output", value: output });
    const value = z.record(z.string(), z.unknown()).parse(output);
    const status = value.status === "failed" ? "failed" : value.status === "invalid" ? "invalid_output" : "success";
    try {
      const saved = z.array(Row).max(1).parse(await privileged().update("ai_generations", { ...key, id: `eq.${id}`, status: "eq.running" },
        { status, output_json: z.json().parse(checkpoint), finished_at: now(), error_code: null }));
      if (saved[0]) return replay(validate(saved[0]));
    } catch (error) {
      const saved = await read(); if (saved?.output_json) return replay(saved);
      throw error;
    }
    const saved = await read(); if (saved) return replay(saved);
    throw new GenerationClaimError("PERSISTENCE_UNAVAILABLE", 503);
  } };
}
export type GenerationClaims = ReturnType<typeof generationClaims>;
