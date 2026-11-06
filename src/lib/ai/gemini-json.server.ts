import "server-only";
import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { geminiFetch, GEMINI_CONNECT_TIMEOUT_MS, type GeminiTransportPhase } from "./gemini-fetch.server";
import { createGeminiDebugTrace, errorDiagnostics, type GeminiDebugTrace, type GeminiDebugStage } from "./gemini-debug.server";
export type ProviderFailureCode = "CONFIGURATION_ERROR" | "PROVIDER_REFUSED" | "PROVIDER_TIMEOUT" | "PROVIDER_RATE_LIMITED" | "MODEL_UNAVAILABLE" | "PROVIDER_UNAVAILABLE" | "INVALID_RESPONSE";
type JsonResult = { success: true; text: string; model: string; requestId: string | null } | { success: false; code: ProviderFailureCode };
export type GeminiJsonProvider = { generate(prompt: { input: string; systemInstruction: string }): Promise<JsonResult> };

export const GeminiConfigSchema = z.strictObject({
  apiKey: z.string().trim().min(1), model: z.string().regex(/^gemini-[a-zA-Z0-9.-]{1,100}$/).refine(model => !/embedding/i.test(model)),
  timeoutMs: z.number().int().min(10).max(120_000).default(20_000),
  maxAttempts: z.number().int().min(1).max(2).default(2),
});
const EnvelopeSchema = z.object({
  // Stateless (store:false) responses can omit id despite the upstream reference marking it required.
  id: z.string().min(1).max(256).optional(), status: z.string(), output_text: z.string().max(64_000).optional(),
  errors: z.array(z.object({ code: z.string().optional() })).optional(),
});
// Keep existing timeout classification while verbose diagnostics recognize additional constructor names.
const timeoutNames = new Set(["TimeoutError", "AbortError", "APIConnectionTimeoutError", "APIUserAbortError", "RequestAbortedError", "RequestTimeoutError", "ContinuationTimeoutError"]);
function errorCode(diagnostic: ReturnType<typeof errorDiagnostics>): ProviderFailureCode {
  const status = diagnostic.httpStatus;
  if (status === 429) return "PROVIDER_RATE_LIMITED";
  if (status === 404) return "MODEL_UNAVAILABLE";
  if (status === 408 || diagnostic.errorChain.some(node => timeoutNames.has(node.name))) return "PROVIDER_TIMEOUT";
  if (status !== null && status >= 400 && status < 500) return "CONFIGURATION_ERROR";
  return "PROVIDER_UNAVAILABLE";
}

/** SDK retries/continuations disabled: this adapter owns the total deadline and at most one retry. */
export function createGeminiJsonProvider(configInput: unknown, schema: z.ZodType, debug: GeminiDebugTrace = createGeminiDebugTrace()): GeminiJsonProvider {
  const parsed = GeminiConfigSchema.safeParse(configInput);
  return {
    async generate(prompt): Promise<JsonResult> {
      if (!parsed.success) { debug.issues("PROVIDER_CONFIGURATION", parsed.error, configInput); return { success: false, code: "CONFIGURATION_ERROR" }; }
      const config = parsed.data;
      debug.event("PROVIDER_CONFIGURATION", "SUCCESS", { model: config.model, timeoutMs: config.timeoutMs, connectTimeoutMs: GEMINI_CONNECT_TIMEOUT_MS, apiKeyConfigured: true });
      const deadline = Date.now() + config.timeoutMs;
      let lastCode: ProviderFailureCode = "PROVIDER_UNAVAILABLE";
      for (let attempt = 0; attempt < config.maxAttempts; attempt++) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) return { success: false, code: "PROVIDER_TIMEOUT" };
        const controller = new AbortController();
        let timer: ReturnType<typeof setTimeout> | undefined;
        const attemptStartedAt = Date.now();
        let stage = "sdk_initialization";
        let transportInvoked = false;
        let responseReceived = false;
        let upstreamHttpStatus: number | null = null;
        let transportStartedAt: number | null = null;
        let transportPhase: GeminiTransportPhase | null = null;
        try {
          debug.event("PROVIDER_INITIALIZATION", "STARTED", { attempt: attempt + 1 });
          const client = new GoogleGenAI({ apiKey: config.apiKey, httpOptions: { fetch: async (input, options) => {
            stage = "http_transport";
            transportInvoked = true;
            transportStartedAt = Date.now();
            debug.event("TRANSPORT", "STARTED", { attempt: attempt + 1, transportInvoked: true, responseReceived: false });
            const response = await geminiFetch(input, options, debug.enabled ? (phase) => {
              transportPhase = phase;
              debug.event("TRANSPORT", phase === "response_complete" ? "SUCCESS" : "STARTED", { dispatcherInvoked: true, transportPhase: phase,
                connectTimeoutMs: GEMINI_CONNECT_TIMEOUT_MS, attempt: attempt + 1, transportMs: Date.now() - (transportStartedAt ?? attemptStartedAt) });
            } : undefined);
            upstreamHttpStatus = response.status;
            responseReceived = true;
            stage = "sdk_response";
            debug.event("UPSTREAM_HTTP", response.ok ? "SUCCESS" : "FAILED", { httpStatus: response.status, headers: response.headers, transportInvoked, responseReceived, transportMs: Date.now() - transportStartedAt });
            return response;
          } } });
          debug.event("PROVIDER_INITIALIZATION", "SUCCESS");
          stage = "request_construction";
          const responseSchema = z.toJSONSchema(schema, { target: "draft-07" });
          debug.event("REQUEST_PREPARATION", "SUCCESS", { schemaCreated: true, inputBytes: Buffer.byteLength(prompt.input),
            systemBytes: Buffer.byteLength(prompt.systemInstruction), schemaBytes: Buffer.byteLength(JSON.stringify(responseSchema)),
            estimatedInputTokens: Math.ceil(Buffer.byteLength(prompt.input + prompt.systemInstruction) / 4) });
          stage = "sdk_call";
          debug.event("SDK_REQUEST", "STARTED", { model: config.model, attempt: attempt + 1 });
          const response: unknown = await Promise.race([
            client.interactions.create({
              model: config.model, input: prompt.input, system_instruction: prompt.systemInstruction,
              response_format: { type: "text", mime_type: "application/json",
                schema: responseSchema },
              store: false, stream: false, tools: [], automatic_continuation: false,
              generation_config: { max_output_tokens: 4_096 },
            }, { timeout_ms: remaining, retries: { strategy: "none" }, fetchOptions: { signal: controller.signal } }),
            new Promise<never>((_, reject) => {
              timer = setTimeout(() => { controller.abort(); reject(new DOMException("Provider deadline", "TimeoutError")); }, remaining);
            }),
          ]);
          stage = "response_validation";
          debug.event("INTERACTION_RESPONSE", "STARTED", { response, httpStatus: upstreamHttpStatus });
          const envelope = EnvelopeSchema.safeParse(response);
          if (!envelope.success) { debug.issues("INTERACTION_RESPONSE", envelope.error, response); return { success: false, code: "INVALID_RESPONSE" }; }
          if (envelope.data.errors?.some((error) => /safety|block|refus|prohibited/i.test(error.code ?? ""))) {
            debug.event("INTERACTION_RESPONSE", "FAILED", { code: "PROVIDER_REFUSED" });
            return { success: false, code: "PROVIDER_REFUSED" };
          }
          if (envelope.data.status !== "completed") { debug.event("INTERACTION_RESPONSE", "FAILED", { code: "PROVIDER_UNAVAILABLE", response }); return { success: false, code: "PROVIDER_UNAVAILABLE" }; }
          if (!envelope.data.output_text) { debug.event("INTERACTION_RESPONSE", "FAILED", { code: "INVALID_RESPONSE", response }); return { success: false, code: "INVALID_RESPONSE" }; }
          debug.event("INTERACTION_RESPONSE", "SUCCESS");
          debug.event("SDK_REQUEST", "SUCCESS");
          return { success: true, text: envelope.data.output_text, model: config.model, requestId: envelope.data.id ?? null };
        } catch (error: unknown) {
          if (timer !== undefined) clearTimeout(timer);
          const diagnostic = errorDiagnostics(error);
          diagnostic.httpStatus ??= upstreamHttpStatus;
          lastCode = errorCode(diagnostic);
          const failureStage: GeminiDebugStage = responseReceived ? (upstreamHttpStatus !== null && upstreamHttpStatus >= 400 ? "UPSTREAM_HTTP" : "INTERACTION_RESPONSE") : transportInvoked ? "TRANSPORT"
            : stage === "sdk_initialization" ? "PROVIDER_INITIALIZATION" : stage === "request_construction" ? "REQUEST_PREPARATION" : "SDK_REQUEST";
          debug.event(failureStage, "FAILED", { code: lastCode, model: config.model, attempt: attempt + 1, error,
            httpStatus: diagnostic.httpStatus, transportInvoked, responseReceived, transportPhase, transportMs: transportStartedAt === null ? undefined : Date.now() - transportStartedAt });
          console.warn("Gemini request failed", { code: lastCode, model: config.model, attempt: attempt + 1, httpStatus: diagnostic.httpStatus,
            ...(debug.enabled ? { ...diagnostic, stage, transportInvoked, responseReceived, transportPhase, elapsedMs: Date.now() - attemptStartedAt } : {}) });
          if (!["PROVIDER_RATE_LIMITED", "PROVIDER_TIMEOUT", "PROVIDER_UNAVAILABLE"].includes(lastCode)) break;
          const delay = Math.min(500 * (attempt + 1), deadline - Date.now());
          if (attempt + 1 < config.maxAttempts && delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
        } finally { if (timer !== undefined) clearTimeout(timer); }
      }
      return { success: false, code: lastCode };
    },
  };
}

export type GeminiEnvironment = { GEMINI_API_KEY?: string; GEMINI_MODEL?: string; GEMINI_TIMEOUT_MS?: string };
export function geminiConfiguration(env: GeminiEnvironment) {
  const parsed = GeminiConfigSchema.safeParse({ apiKey: env.GEMINI_API_KEY, model: env.GEMINI_MODEL,
    timeoutMs: env.GEMINI_TIMEOUT_MS === undefined ? 20_000 : Number(env.GEMINI_TIMEOUT_MS), maxAttempts: 1 });
  if (!parsed.success) throw new Error("CONFIGURATION_ERROR");
  return parsed.data;
}
