import { afterEach, expect, it, vi } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { z } from "zod";
vi.mock("server-only", () => ({}));
import { blueprintFixture } from "../fixtures/blueprint";
import { evaluationFixture } from "../fixtures/evaluation";
import { buildBusinessContext } from "../../src/features/ai-context";
import { buildStrategyPrompt } from "../../src/features/campaign-strategist/prompt";
import { createGeminiStrategyProvider } from "../../src/features/campaign-strategist/gemini.server";
import { configuredBlueprintProvider } from "../../src/features/campaign-blueprint/gemini.server";
import { configuredEvaluationProvider } from "../../src/features/campaign-evaluation/gemini.server";
import { calculateEvaluation } from "../../src/features/campaign-evaluation/calculate";
import { EvaluationSummarySchema, EvaluationContextSchema } from "../../src/features/campaign-evaluation/contracts";

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
it("measures installed SDK payloads locally without sending provider requests", async () => {
  const env = { NODE_ENV: "test", CAMPAIGN_DISCUSSION_PROVIDER: "gemini", CAMPAIGN_DISCUSSION_CONTEXT: "seeded", CAMPAIGN_BLUEPRINT_PROVIDER: "gemini",
    CAMPAIGN_EVALUATION_PROVIDER: "gemini", CAMPAIGN_EVALUATION_MODE: "synthetic", GEMINI_API_KEY: "synthetic-no-network", GEMINI_MODEL: "gemini-3.6-flash", GEMINI_TIMEOUT_MS: "60000" };
  const f = await blueprintFixture(), e = await evaluationFixture(), context = buildBusinessContext(f.contextInput);
  if (!context.success) throw Error("Invalid fixture");
  const prompt = buildStrategyPrompt(context.data, { ...f.contextInput.scope, sessionId: null, requestKey: "local-measurement", expectedVersion: 1, expectedContextHash: context.data.contextHash, message: "Buat pengingat preorder", preferences: { budgetCapIdr: 50000, allowDiscount: false, channels: ["whatsapp"] }, history: [] });
  const rows: Record<string, unknown>[] = [];
  let currentModule = "";
  const transport = vi.fn<typeof fetch>(async (input, init) => {
    const request = new Request(input, init), body = z.record(z.string(), z.unknown()).parse(await request.json());
    const schema = z.object({ properties: z.record(z.string(), z.unknown()) }).parse(z.object({ schema: z.unknown() }).parse(body.response_format).schema);
    const inputText = z.string().parse(body.input), instruction = z.string().parse(body.system_instruction);
    rows.push({ module: currentModule, inputBytes: Buffer.byteLength(inputText), systemBytes: Buffer.byteLength(instruction),
      schemaBytes: Buffer.byteLength(JSON.stringify(schema)), requestBytes: Buffer.byteLength(JSON.stringify(body)),
      estimatedInputTokens: Math.ceil(Buffer.byteLength(inputText + instruction) / 4), requiredOutputFields: Object.keys(schema.properties).length,
      generationConfig: body.generation_config, store: body.store, stream: body.stream });
    return Response.json({ status: "completed", steps: [{ type: "model_output", content: [{ type: "text", text: "{}" }] }] });
  });
  vi.stubGlobal("fetch", transport); vi.spyOn(console, "warn").mockImplementation(() => {});
  currentModule = "Strategist fixture";
  await createGeminiStrategyProvider({ apiKey: env.GEMINI_API_KEY, model: env.GEMINI_MODEL, timeoutMs: 60000, maxAttempts: 1 }).generate(prompt);
  currentModule = "Blueprint fixture";
  await configuredBlueprintProvider("valid", env).generate({ alternative: f.input.selected.alternative, edits: f.input.command.edits, now: f.dependencies.now() }).catch(() => {});
  currentModule = "Evaluation fixture";
  await configuredEvaluationProvider("valid", env).generate({ summary: calculateEvaluation(e.context), references: e.context.references });
  if (process.env.EVALUATION_PERF_REPORT) {
    const query = "SELECT jsonb_build_object('summary',metrics_json->'summary','references',metrics_json#>'{context,references}') FROM public.campaign_evaluations WHERE id='5e4d2dba-3a5b-4538-870e-c4ef72b01dcf';";
    const raw: unknown = JSON.parse(execFileSync("docker", ["exec", "-i", "supabase_db_campaign-lab", "psql", "-U", "postgres", "-d", "postgres", "-X", "-qAt", "-v", "ON_ERROR_STOP=1"], { input: query, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }));
    const actual = z.object({ summary: EvaluationSummarySchema, references: EvaluationContextSchema.shape.references }).parse(raw);
    currentModule = "Evaluation failed-row snapshot";
    await configuredEvaluationProvider("valid", env).generate(actual);
    mkdirSync("node_modules/.cache/evaluation-timeout", { recursive: true });
    const label = process.env.EVALUATION_PERF_REPORT === "before" ? "before" : "after";
    writeFileSync("node_modules/.cache/evaluation-timeout/payload-" + label + ".json", JSON.stringify({ measuredAt: new Date().toISOString(), liveProviderCalls: 0, tokenEstimate: "UTF-8 bytes /4; not model tokenization", rows }, null, 2) + "\n");
  }
  expect(transport).toHaveBeenCalledTimes(process.env.EVALUATION_PERF_REPORT ? 4 : 3);
  expect(rows).toEqual(expect.arrayContaining([expect.objectContaining({ module: "Evaluation fixture", requiredOutputFields: 13, generationConfig: { max_output_tokens: 4096 }, store: false, stream: false })]));
});
