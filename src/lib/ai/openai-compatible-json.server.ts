import "server-only";
import { z } from "zod";
import type { GeminiDebugTrace } from "./gemini-debug.server";
import type { JsonResult, ProviderFailureCode } from "./gemini-json.server";

type CompatibleConfig = { apiKey: string; model: string; timeoutMs: number; maxAttempts: number; baseUrl: string };
const SUBMIT_TOOL = "submit_json";
const CompletionSchema = z.object({
  id: z.string().min(1).max(256).optional(),
  choices: z.array(z.object({
    message: z.object({ content: z.string().nullable().optional(),
      tool_calls: z.array(z.object({ function: z.object({ name: z.string(), arguments: z.string() }) })).nullable().optional() }),
    finish_reason: z.string().nullable().optional(),
  })).min(1),
});

function statusCode(status: number): ProviderFailureCode {
  if (status === 429) return "PROVIDER_RATE_LIMITED";
  if (status === 404) return "MODEL_UNAVAILABLE";
  if (status === 408 || status === 504) return "PROVIDER_TIMEOUT";
  // 401/403 (key) and 402 (balance used up) need the operator, so the owner is told the AI is not set up.
  if (status >= 400 && status < 500) return "CONFIGURATION_ERROR";
  return "PROVIDER_UNAVAILABLE";
}
/** Some models wrap the object in a markdown fence even in JSON mode. */
function unfence(text: string) {
  const fenced = /^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/i.exec(text);
  return (fenced ? fenced[1] : text).trim();
}

/**
 * OpenAI-compatible chat completions (CosmosHub). The schema is sent as the parameters of one forced function call:
 * with deepseek-v4.1-flash on CosmosHub, json_schema and json_object modes returned prose or a made-up shape, while a
 * forced tool call followed the schema. Every caller still validates the result with zod. Retries only 429/503.
 */
export async function generateCompatibleJson(config: CompatibleConfig, schema: z.ZodType, prompt: { input: string; systemInstruction: string },
  debug: GeminiDebugTrace, maxOutputTokens: number): Promise<JsonResult> {
  const responseSchema = z.toJSONSchema(schema, { target: "draft-07" });
  const body = JSON.stringify({ model: config.model, stream: false, max_tokens: maxOutputTokens,
    tools: [{ type: "function", function: { name: SUBMIT_TOOL, description: "Submit the final answer.", parameters: responseSchema } }],
    tool_choice: { type: "function", function: { name: SUBMIT_TOOL } },
    messages: [
      { role: "system", content: `${prompt.systemInstruction}\n\nSubmit your answer only by calling ${SUBMIT_TOOL}. Do not reply with prose.` },
      { role: "user", content: prompt.input },
    ] });
  debug.event("REQUEST_PREPARATION", "SUCCESS", { schemaCreated: true, inputBytes: Buffer.byteLength(prompt.input) });
  const deadline = Date.now() + config.timeoutMs;
  let lastCode: ProviderFailureCode = "PROVIDER_UNAVAILABLE";
  for (let attempt = 0; attempt < config.maxAttempts; attempt++) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return { success: false, code: "PROVIDER_TIMEOUT" };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), remaining);
    try {
      debug.event("SDK_REQUEST", "STARTED", { model: config.model, attempt: attempt + 1 });
      const response = await fetch(`${config.baseUrl.replace(/\/+$/, "")}/chat/completions`, { method: "POST", signal: controller.signal,
        headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" }, body });
      const raw: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        lastCode = statusCode(response.status);
        debug.event("UPSTREAM_HTTP", "FAILED", { code: lastCode, httpStatus: response.status, attempt: attempt + 1 });
        console.warn("AI provider request failed", { code: lastCode, model: config.model, attempt: attempt + 1, httpStatus: response.status });
        if (response.status !== 429 && response.status !== 503) break;
        const delay = Math.min(1_500 * (attempt + 1), deadline - Date.now());
        if (attempt + 1 < config.maxAttempts && delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }
      const parsed = CompletionSchema.safeParse(raw);
      if (!parsed.success) { debug.event("INTERACTION_RESPONSE", "FAILED", { code: "INVALID_RESPONSE" }); return { success: false, code: "INVALID_RESPONSE" }; }
      const choice = parsed.data.choices[0];
      if (choice.finish_reason === "length") { debug.event("INTERACTION_RESPONSE", "FAILED", { code: "OUTPUT_TRUNCATED" }); return { success: false, code: "OUTPUT_TRUNCATED" }; }
      if (choice.finish_reason === "content_filter") { debug.event("INTERACTION_RESPONSE", "FAILED", { code: "PROVIDER_REFUSED" }); return { success: false, code: "PROVIDER_REFUSED" }; }
      // Prefer the forced call's arguments; a model that answers in plain content still gets one chance to parse.
      const call = choice.message.tool_calls?.find((entry) => entry.function.name === SUBMIT_TOOL);
      const text = unfence(call?.function.arguments ?? choice.message.content ?? "");
      if (!text || text.length > 64_000) { debug.event("INTERACTION_RESPONSE", "FAILED", { code: "INVALID_RESPONSE" }); return { success: false, code: "INVALID_RESPONSE" }; }
      debug.event("SDK_REQUEST", "SUCCESS");
      return { success: true, text, model: config.model, requestId: parsed.data.id ?? null };
    } catch {
      // A timeout or lost connection may already have produced (and billed) an answer, so it is never retried.
      lastCode = controller.signal.aborted ? "PROVIDER_TIMEOUT" : "PROVIDER_UNAVAILABLE";
      debug.event("SDK_REQUEST", "FAILED", { code: lastCode, attempt: attempt + 1 });
      console.warn("AI provider request failed", { code: lastCode, model: config.model, attempt: attempt + 1 });
      break;
    } finally { clearTimeout(timer); }
  }
  return { success: false, code: lastCode };
}
