import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
vi.mock("server-only", () => ({}));
import { configuredEvaluationProvider } from "../../src/features/campaign-evaluation/gemini.server";
import { configuredMemoryProvider } from "../../src/features/business-memory/gemini.server";
import { EvaluationNarrativeSchema } from "../../src/features/campaign-evaluation/contracts";
import { interpretEvaluation } from "../../src/features/campaign-evaluation/engine";
import { calculateEvaluation } from "../../src/features/campaign-evaluation/calculate";
import { generateMemoryInterpretation } from "../../src/features/business-memory/domain";
import { developmentEvaluationProvider } from "../../src/features/campaign-evaluation/development-provider";
import { evaluationFixture, evaluationEnvironment } from "../fixtures/evaluation";
import { memoryFixture } from "../fixtures/memory";

const env = { NODE_ENV: "test", CAMPAIGN_EVALUATION_MODE: "synthetic", CAMPAIGN_EVALUATION_PROVIDER: "gemini",
  CAMPAIGN_MEMORY_PROVIDER: "gemini", GEMINI_MODEL: "gemini-3.6-flash", GEMINI_API_KEY: "synthetic-key", GEMINI_TIMEOUT_MS: "60000" };
const transport = vi.fn<typeof fetch>();
const wire = (value: unknown, id?: string) => Response.json({ ...(id === undefined ? {} : { id }), status: "completed",
  steps: [{ type: "model_output", content: [{ type: "text", text: JSON.stringify(value) }] }] });
beforeEach(() => { transport.mockReset(); vi.stubGlobal("fetch", transport); vi.spyOn(console, "warn").mockImplementation(() => {}); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe("remaining modules: installed SDK, mocked HTTP, no paid generation", () => {
  it.each(["synthetic-provider-id", undefined])("grounds evaluation with nullable provider id %s", async id => {
    const f = await evaluationFixture(), summary = calculateEvaluation(f.context);
    const narrative = await developmentEvaluationProvider("valid", evaluationEnvironment).generate({ summary, references: f.context.references });
    transport.mockResolvedValue(wire(narrative, id));
    const result = await interpretEvaluation(f.context, summary, configuredEvaluationProvider("valid", env), () => f.now);
    expect(result).toMatchObject({ provider: "gemini", model: env.GEMINI_MODEL, providerRequestId: id ?? null, generatedAt: f.now, synthetic: true, status: "available" });
    expect(transport).toHaveBeenCalledTimes(1);
    const request = new Request(transport.mock.calls[0][0], transport.mock.calls[0][1]);
    expect(await request.json()).toMatchObject({ model: env.GEMINI_MODEL, store: false, stream: false, generation_config: { max_output_tokens: 4096 } });
  });
  it.each(["synthetic-provider-id", undefined])("grounds memory with nullable provider id %s", async id => {
    const f = await memoryFixture(); transport.mockResolvedValue(wire(f.row.lessons_json.interpretation, id));
    const result = await generateMemoryInterpretation(f.source, configuredMemoryProvider("valid", env), () => f.now);
    expect(result).toMatchObject({ provider: "gemini", model: env.GEMINI_MODEL, providerRequestId: id ?? null, generatedAt: f.now,
      interpretation: { sourceEvaluationId: f.source.evaluationId, businessId: f.source.businessId } });
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it("rejects invented evaluation numbers and unsupported memory references", async () => {
    const f = await evaluationFixture(), summary = calculateEvaluation(f.context);
    const narrative = await developmentEvaluationProvider("valid", evaluationEnvironment).generate({ summary, references: f.context.references });
    transport.mockResolvedValue(wire({ ...z.record(z.string(), z.unknown()).parse(narrative), summary: "Pendapatan naik 999 persen" }));
    expect((await interpretEvaluation(f.context, summary, configuredEvaluationProvider("valid", env))).status).toBe("invalid");
    const m = await memoryFixture(); transport.mockResolvedValue(wire({ ...m.row.lessons_json.interpretation, evidenceReferences: ["invented"] }));
    await expect(generateMemoryInterpretation(m.source, configuredMemoryProvider("valid", env))).rejects.toMatchObject({ code: "INVALID_MEMORY_OUTPUT" });
  });
  it.each([503, 429])("does not retry HTTP %s or fall back to Fake", async status => {
    const f = await evaluationFixture(); transport.mockResolvedValue(Response.json({ error: { code: status, message: "synthetic provider failure" } }, { status }));
    const result = await interpretEvaluation(f.context, calculateEvaluation(f.context), configuredEvaluationProvider("valid", env));
    expect(result).toMatchObject({ provider: "gemini", status: "failed", providerRequestId: null });
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it("aligns backend schema and prompt while accepting genuine uncertainty", async () => {
    const f = await evaluationFixture(), summary = calculateEvaluation(f.context);
    const narrative = z.record(z.string(), z.unknown()).parse(await developmentEvaluationProvider("valid", evaluationEnvironment).generate({ summary, references: f.context.references }));
    transport.mockResolvedValue(wire({ ...narrative, summary: "Ada ketidakpastian pada pengamatan." }));
    expect((await interpretEvaluation(f.context, summary, configuredEvaluationProvider("valid", env))).status).toBe("available");
    const request = new Request(transport.mock.calls[0][0], transport.mock.calls[0][1]);
    const body = z.object({ system_instruction: z.string(), response_format: z.object({ schema: z.object({ additionalProperties: z.literal(false),
      properties: z.object({ outcome: z.object({ const: z.string() }), financialState: z.object({ const: z.string() }),
        executionState: z.object({ const: z.string() }), evidenceReferences: z.object({ items: z.object({ enum: z.array(z.string()) }) }) }) }) }) }).parse(await request.json());
    expect(body.response_format.schema.properties).toMatchObject({ outcome: { const: "above_target" }, financialState: { const: "positive" }, executionState: { const: "incomplete" } });
    expect(body.response_format.schema.properties.evidenceReferences.items.enum).toEqual(f.context.references);
    expect(body.system_instruction).toContain("Uncertainty is allowed");
    expect(body.system_instruction).not.toContain("do not use ketidakpastian");
  });

  it.each([
    [{ risks: ["Penjualan pasti meningkat."] }, "narrative_domain", "guaranteed_outcome", "risks.0"],
    [{ outcome: "below_target" }, "narrative_domain", "classification_mismatch", "outcome"],
    [{ summary: 123 }, "narrative_schema", "schema_invalid", "summary"],
    [{ privateCustomerSecret: "PRIVATE_TEST_VALUE" }, "narrative_schema", "schema_invalid", "$"],
  ])("logs safe stage, path and correlation for rejected Evaluation %s", async (patch, stage, category, fieldPath) => {
    vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("GEMINI_DEBUG", "true");
    const f = await evaluationFixture(), summary = calculateEvaluation(f.context);
    const narrative = z.record(z.string(), z.unknown()).parse(await developmentEvaluationProvider("valid", evaluationEnvironment).generate({ summary, references: f.context.references }));
    transport.mockResolvedValue(wire({ ...narrative, ...patch }, "synthetic-provider-id"));
    const requestId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    const result = await interpretEvaluation(f.context, summary, configuredEvaluationProvider("valid", env), () => f.now, requestId);
    expect(result).toMatchObject({ status: "invalid", narrative: null, providerRequestId: "synthetic-provider-id" });
    const events = vi.mocked(console.warn).mock.calls.filter(([tag]) => tag === "Evaluation output rejected");
    expect(events).toHaveLength(1); expect(JSON.parse(String(events[0][1]))).toMatchObject({ stage, category, fieldPath, requestId, code: "INVALID_AI_EVALUATION" });
    expect(JSON.stringify(events)).not.toMatch(/Penjualan|PRIVATE_TEST_VALUE|privateCustomerSecret|synthetic-key/);
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it.each([
    { status: "in_progress" },
    { status: "completed", errors: [{ code: "SAFETY" }] },
  ])("does not accept incomplete/refused interaction %s", async response => {
    const f = await evaluationFixture();
    transport.mockResolvedValue(Response.json(response));
    expect((await interpretEvaluation(f.context, calculateEvaluation(f.context), configuredEvaluationProvider("valid", env))).status).toBe("failed");
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("identifies an unavailable evidence reference without logging its prose", async () => {
    vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("GEMINI_DEBUG", "true");
    const f = await evaluationFixture("unavailable"), summary = calculateEvaluation(f.context);
    const narrative = EvaluationNarrativeSchema.parse(await developmentEvaluationProvider("valid", evaluationEnvironment).generate({ summary, references: f.context.references }));
    transport.mockResolvedValue(wire({ ...narrative, evidenceReferences: ["c6"] }));
    expect((await interpretEvaluation(f.context, summary, configuredEvaluationProvider("valid", env))).status).toBe("invalid");
    const events = vi.mocked(console.warn).mock.calls.filter(([tag]) => tag === "Evaluation output rejected");
    expect(JSON.parse(String(events[0][1]))).toMatchObject({ stage: "narrative_domain", category: "unsupported_reference", fieldPath: "evidenceReferences.0", unsupportedReferences: true });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("bounds a hung Evaluation provider without retries", async () => {
    vi.useFakeTimers(); const f = await evaluationFixture();
    transport.mockImplementation(() => new Promise(() => {}));
    const result = interpretEvaluation(f.context, calculateEvaluation(f.context), configuredEvaluationProvider("valid", { ...env, GEMINI_TIMEOUT_MS: "20" }));
    await vi.advanceTimersByTimeAsync(21); expect((await result).status).toBe("failed"); expect(transport).toHaveBeenCalledTimes(1);
  });

  it("records invalid JSON as invalid Evaluation without accepting invented evidence", async () => {
    vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("GEMINI_DEBUG", "true");
    const f = await evaluationFixture(); transport.mockResolvedValue(Response.json({ status: "completed", steps: [{ type: "model_output", content: [{ type: "text", text: "{invalid" }] }] }));
    expect((await interpretEvaluation(f.context, calculateEvaluation(f.context), configuredEvaluationProvider("valid", env))).status).toBe("invalid");
    const events = vi.mocked(console.warn).mock.calls.filter(([tag]) => tag === "Evaluation output rejected");
    expect(JSON.parse(String(events[0][1]))).toMatchObject({ stage: "provider_json", category: "json_invalid", fieldPath: "$" });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("does not allow fake failure scenarios or Fake in a development real-provider route", () => {
    expect(() => configuredEvaluationProvider("failure", env)).toThrow("FAKE_SCENARIO_DISABLED");
    expect(() => configuredMemoryProvider("missing_evidence", env)).toThrow("FAKE_SCENARIO_DISABLED");
    expect(() => configuredEvaluationProvider("valid", { ...env, NODE_ENV: "development", CAMPAIGN_EVALUATION_PROVIDER: "fake" })).toThrow();
    expect(() => configuredMemoryProvider("valid", { ...env, NODE_ENV: "development", CAMPAIGN_MEMORY_PROVIDER: "fake" })).toThrow();
    expect(transport).not.toHaveBeenCalled();
  });
});

