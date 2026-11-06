import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("server-only", () => ({}));
import { createGeminiJsonProvider } from "../../src/lib/ai/gemini-json.server";
import { createGeminiStrategyProvider } from "../../src/features/campaign-strategist/gemini.server";

const config = { apiKey: "synthetic-secret-key", model: "gemini-3.8-flash", maxAttempts: 1, timeoutMs: 60_000 };
const prompt = { input: "private-prompt-marker", systemInstruction: "private-system-marker" };
const schema = z.object({ text: z.string() });
const transport = vi.fn<typeof fetch>();
const log = vi.spyOn(console, "warn").mockImplementation(() => {});
const wireReply = { id: "synthetic-id", status: "completed", steps: [{ type: "model_output", content: [{ type: "text", text: "{}" }] }] };
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

beforeEach(() => { transport.mockReset(); log.mockClear(); vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("GEMINI_DEBUG", "true"); vi.stubGlobal("fetch", transport); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("installed Gemini SDK with fully mocked HTTP (no network or inference)", () => {
  it("constructs the actual Strategist request through SDK 2.32.0 and preserves a completed envelope", async () => {
    transport.mockResolvedValue(response(wireReply));
    expect(await createGeminiStrategyProvider(config).generate(prompt)).toMatchObject({ success: true, text: "{}" });
    expect(transport).toHaveBeenCalledTimes(1);
    expect(transport.mock.calls[0][1]).toHaveProperty("dispatcher");
    const request = new Request(transport.mock.calls[0][0], transport.mock.calls[0][1]);
    expect(request).toBeInstanceOf(Request);
    if (!(request instanceof Request)) throw Error("Expected SDK Request");
    expect(new URL(request.url).pathname).toBe("/v1beta/interactions");
    expect(request.method).toBe("POST");
    expect(await request.clone().json()).toMatchObject({ model: config.model, input: prompt.input,
      system_instruction: prompt.systemInstruction, store: false, stream: false, tools: [],
      generation_config: { max_output_tokens: 4096 }, response_format: { type: "text", mime_type: "application/json", schema: { type: "object" } } });
    expect(await request.clone().json()).not.toHaveProperty("automatic_continuation");
    expect(typeof transport.mock.calls[0][0]).toBe("string");
  });

  it("accepts an unstored completed interaction without id through the installed SDK, preserving valid output JSON", async () => {
    transport.mockResolvedValue(response({ status: "completed", steps: [{ type: "model_output", content: [{ type: "text", text: '{"text":"synthetic output"}' }] }] }));
    const result = await createGeminiJsonProvider(config, schema).generate(prompt);
    expect(result).toEqual({ success: true, text: '{"text":"synthetic output"}', model: config.model, requestId: null });
    if (!result.success) throw Error("Expected completed interaction");
    expect(schema.parse(JSON.parse(result.text))).toEqual({ text: "synthetic output" });
    expect(transport).toHaveBeenCalledTimes(1);
    const request = new Request(transport.mock.calls[0][0], transport.mock.calls[0][1]);
    expect(await request.json()).toMatchObject({ store: false, model: config.model });
  });

  it.each([[403, "CONFIGURATION_ERROR"], [404, "MODEL_UNAVAILABLE"], [429, "PROVIDER_RATE_LIMITED"], [503, "PROVIDER_UNAVAILABLE"]])(
    "preserves upstream HTTP %s through the real SDK wrapper without retries", async (status, code) => {
      transport.mockResolvedValue(response({ error: { code: status, message: "private-response-marker synthetic-secret-key" } }, status));
      expect(await createGeminiJsonProvider(config, schema).generate(prompt)).toEqual({ success: false, code });
      expect(transport).toHaveBeenCalledTimes(1);
      expect(log).toHaveBeenLastCalledWith("Gemini request failed", expect.objectContaining({ code, httpStatus: status,
        sdkStatus: status, sdkStatusCode: status, transportInvoked: true, responseReceived: true, stage: "sdk_response" }));
      const serialized = JSON.stringify(log.mock.calls);
      for (const secret of [config.apiKey, prompt.input, prompt.systemInstruction, "private-response-marker"])
        expect(serialized).not.toContain(secret);
    });

  it("finds a nested DNS cause through actual SDK connection wrappers without claiming HTTP delivery", async () => {
    transport.mockRejectedValue(new TypeError("fetch failed private-response-marker", {
      cause: Object.assign(new Error("private-response-marker"), { code: "ENOTFOUND" }),
    }));
    expect(await createGeminiJsonProvider(config, schema).generate(prompt)).toEqual({ success: false, code: "PROVIDER_UNAVAILABLE" });
    expect(transport).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenLastCalledWith("Gemini request failed", expect.objectContaining({ errorName: "APIConnectionError",
      causeCode: "ENOTFOUND", httpStatus: null, transportInvoked: true, responseReceived: false, stage: "http_transport" }));
    expect(JSON.stringify(log.mock.calls)).not.toContain("private-response-marker");
  });

  it("distinguishes local schema construction failure before fetch", async () => {
    const unsupported = z.object({ text: z.string().transform(value => value.trim()) });
    expect(await createGeminiJsonProvider(config, unsupported).generate(prompt)).toEqual({ success: false, code: "PROVIDER_UNAVAILABLE" });
    expect(transport).not.toHaveBeenCalled();
    expect(log).toHaveBeenLastCalledWith("Gemini request failed", expect.objectContaining({ stage: "request_construction",
      errorName: "Error", httpStatus: null, transportInvoked: false, responseReceived: false }));
  });

  it("does not emit verbose details in production even with GEMINI_DEBUG=true", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const errors = vi.spyOn(console, "error").mockImplementation(() => {}), info = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      transport.mockResolvedValue(response({ error: { code: 503, message: "private-response-marker" } }, 503));
      expect(await createGeminiJsonProvider(config, schema).generate(prompt)).toEqual({ success: false, code: "PROVIDER_UNAVAILABLE" });
      expect(errors).not.toHaveBeenCalled(); expect(info).not.toHaveBeenCalled();
      expect(log).toHaveBeenLastCalledWith("Gemini request failed", { code: "PROVIDER_UNAVAILABLE", model: config.model, attempt: 1, httpStatus: 503 });
    } finally { errors.mockRestore(); info.mockRestore(); }
  });

  it("keeps an observed upstream status when SDK response decoding fails", async () => {
    transport.mockResolvedValue(new Response("private-response-marker", { status: 502, headers: { "Content-Type": "application/json" } }));
    expect(await createGeminiJsonProvider(config, schema).generate(prompt)).toMatchObject({ success: false });
    expect(transport).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenLastCalledWith("Gemini request failed", expect.objectContaining({ httpStatus: 502,
      transportInvoked: true, responseReceived: true }));
    expect(JSON.stringify(log.mock.calls)).not.toContain("private-response-marker");
  });
});
