import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const { create, construct } = vi.hoisted(() => ({ create: vi.fn<(request: unknown, options: unknown) => Promise<unknown>>(), construct: vi.fn<(options: unknown) => void>() }));
vi.mock("server-only", () => ({}));
vi.mock("@google/genai", () => ({ GoogleGenAI: class { constructor(options: unknown) { construct(options); } interactions = { create }; } }));
import { createGeminiStrategyProvider } from "../../src/features/campaign-strategist/gemini.server";

const prompt = { systemInstruction: "Trusted system rules", input: "Synthetic sanitized JSON" };
const config = { apiKey: "fake-private-key", model: "gemini-3.8-flash" };
const completed = { id: "synthetic-provider-id", status: "completed", output_text: "{}" };
beforeEach(() => { create.mockReset(); construct.mockReset(); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe("server Gemini adapter with mocked SDK transport", () => {
  it("sends structured output with no tools, provider storage, SDK retries or continuations", async () => {
    create.mockResolvedValue(completed);
    const result = await createGeminiStrategyProvider(config).generate(prompt);
    expect(result).toEqual({ success: true, text: "{}", model: config.model, requestId: completed.id });
    expect(create.mock.calls[0][0]).toMatchObject({
      model: config.model, system_instruction: prompt.systemInstruction, input: prompt.input,
      store: false, stream: false, tools: [], automatic_continuation: false,
      response_format: { type: "text", mime_type: "application/json", schema: { type: "object" } },
      generation_config: { max_output_tokens: 8_192 },
    });
    expect(create.mock.calls[0][1]).toMatchObject({ retries: { strategy: "none" } });
  });

  it.each([null, "", 42, "x".repeat(257)])("rejects a supplied malformed interaction id (%s)", async id => {
    create.mockResolvedValue({ ...completed, id });
    expect(await createGeminiStrategyProvider(config).generate(prompt)).toEqual({ success: false, code: "INVALID_RESPONSE" });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("bounds transient retries to two attempts and preserves rate-limit failure", async () => {
    vi.useFakeTimers();
    create.mockRejectedValue({ status: 429, message: "fake-private-key" });
    const result = createGeminiStrategyProvider(config).generate(prompt);
    await vi.runAllTimersAsync();
    expect(await result).toEqual({ success: false, code: "PROVIDER_RATE_LIMITED" });
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("recovers from one transient server failure without unbounded retries", async () => {
    vi.useFakeTimers();
    create.mockRejectedValueOnce({ statusCode: 503 }).mockResolvedValueOnce(completed);
    const result = createGeminiStrategyProvider(config).generate(prompt);
    await vi.runAllTimersAsync();
    expect(await result).toMatchObject({ success: true });
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("never retries a timeout, because the provider may already have produced an answer", async () => {
    const error = new Error("synthetic timeout"); error.name = "APIConnectionTimeoutError";
    create.mockRejectedValue(error);
    expect(await createGeminiStrategyProvider({ ...config, maxAttempts: 2 }).generate(prompt)).toEqual({ success: false, code: "PROVIDER_TIMEOUT" });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("keeps one attempt by default and lets owner Campaign AI opt into the explicit-rejection retry", async () => {
    const { geminiConfiguration } = await import("../../src/lib/ai/gemini-json.server");
    const env = { GEMINI_API_KEY: "fake-private-key", GEMINI_MODEL: "gemini-3.6-flash" };
    expect(geminiConfiguration(env)).toMatchObject({ maxAttempts: 1, timeoutMs: 60_000 });
    expect(geminiConfiguration(env, 2)).toMatchObject({ maxAttempts: 2 });
    expect(geminiConfiguration({ ...env, GEMINI_TIMEOUT_MS: "30000" })).toMatchObject({ timeoutMs: 30_000 });
  });

  it.each([[400, "CONFIGURATION_ERROR"], [401, "CONFIGURATION_ERROR"], [402, "CONFIGURATION_ERROR"],
    [403, "CONFIGURATION_ERROR"], [404, "MODEL_UNAVAILABLE"]])("does not retry status %s", async (status, code) => {
    create.mockRejectedValue({ status, message: "private credentials and response body" });
    const result = await createGeminiStrategyProvider(config).generate(prompt);
    expect(result).toEqual({ success: false, code });
    expect(create).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toContain("private");
  });

  it("aborts a hung provider within the total deadline even if transport ignores abort", async () => {
    vi.useFakeTimers();
    create.mockImplementation(() => new Promise(() => {}));
    const result = createGeminiStrategyProvider({ ...config, timeoutMs: 20 }).generate(prompt);
    await vi.advanceTimersByTimeAsync(21);
    expect(await result).toEqual({ success: false, code: "PROVIDER_TIMEOUT" });
    expect(create).toHaveBeenCalledTimes(1);
    const options = z.object({ fetchOptions: z.object({ signal: z.instanceof(AbortSignal) }) }).parse(create.mock.calls[0][1]);
    expect(options.fetchOptions.signal.aborted).toBe(true);
  });

  it("handles safety refusal without echoing provider diagnostics", async () => {
    create.mockResolvedValue({ id: "blocked", status: "failed", errors: [{ code: "SAFETY_BLOCKED", message: "private data" }] });
    expect(await createGeminiStrategyProvider(config).generate(prompt)).toEqual({ success: false, code: "PROVIDER_REFUSED" });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("classifies installed SDK timeout wrappers without exposing their messages", async () => {
    const error = new Error("private SDK diagnostic");
    error.name = "APIConnectionTimeoutError";
    create.mockRejectedValue(error);
    expect(await createGeminiStrategyProvider({ ...config, maxAttempts: 1 }).generate(prompt))
      .toEqual({ success: false, code: "PROVIDER_TIMEOUT" });
  });

  it("reports an answer cut off at the output limit as truncated, not busy, and does not retry it", async () => {
    create.mockResolvedValue({ id: "cut", status: "incomplete", output_text: "{\"options\":[" });
    const provider = createGeminiStrategyProvider({ ...config, maxAttempts: 2 });
    expect(await provider.generate(prompt)).toEqual({ success: false, code: "OUTPUT_TRUNCATED" });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it.each([{}, { id: "bad", status: "completed" }, { id: "bad", status: "incomplete", output_text: "partial" },
    { id: "bad", status: "requires_action" },
  ])("rejects missing, incomplete and action-requesting responses", async (response) => {
    create.mockResolvedValue(response);
    expect(await createGeminiStrategyProvider(config).generate(prompt)).toMatchObject({ success: false });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("preserves a valid statusCode despite a null status and untrusted error name", async () => {
    vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("GEMINI_DEBUG", "true");
    const log = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      create.mockRejectedValue({ status: null, statusCode: 429, name: "private-secret-name", message: "private-message" });
      expect(await createGeminiStrategyProvider({ ...config, maxAttempts: 1 }).generate(prompt))
        .toEqual({ success: false, code: "PROVIDER_RATE_LIMITED" });
      expect(log).toHaveBeenLastCalledWith("Gemini request failed", expect.objectContaining({
        httpStatus: 429, sdkStatus: null, sdkStatusCode: 429, errorName: "UnknownError",
      }));
      expect(create).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(log.mock.calls)).not.toContain("private-");
    } finally { log.mockRestore(); }
  });

  it("bounds cyclic causes and suppresses unrecognized codes", async () => {
    vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("GEMINI_DEBUG", "true");
    const log = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const error: { name: string; code: string; cause?: unknown } = { name: "Error", code: "private-secret-code" };
      error.cause = error;
      create.mockRejectedValue(error);
      expect(await createGeminiStrategyProvider({ ...config, maxAttempts: 1 }).generate(prompt))
        .toEqual({ success: false, code: "PROVIDER_UNAVAILABLE" });
      const diagnostic = z.object({ errorChain: z.array(z.unknown()) }).parse(log.mock.calls[0][1]);
      expect(diagnostic.errorChain).toHaveLength(6);
      expect(JSON.stringify(log.mock.calls)).not.toContain("private-secret-code");
    } finally { log.mockRestore(); }
  });

  it.each([["initialization", "PROVIDER_INITIALIZATION"], ["sdk", "SDK_REQUEST"]])("logs a failure during %s before transport", async (boundary, stage) => {
    vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("GEMINI_DEBUG", "true");
    const verbose = vi.spyOn(console, "error").mockImplementation(() => {});
    const debugLog = vi.spyOn(console, "log").mockImplementation(() => {});
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const network = vi.spyOn(globalThis, "fetch");
    try {
      const error = Object.assign(new TypeError("private-sdk-validation-detail"), { code: "ERR_INVALID_ARG_VALUE" });
      if (boundary === "initialization") construct.mockImplementation(() => { throw error; }); else create.mockRejectedValue(error);
      expect(await createGeminiStrategyProvider({ ...config, maxAttempts: 1 }).generate(prompt)).toEqual({ success: false, code: "PROVIDER_UNAVAILABLE" });
      const entry = JSON.parse(String(verbose.mock.calls.at(-1)?.[1]));
      expect(entry).toMatchObject({ stage, result: "FAILED", transportInvoked: false, upstreamHttpResponse: "NO_UPSTREAM_HTTP_RESPONSE",
        error: { constructorName: "TypeError", errorName: "TypeError" } });
      expect(network).not.toHaveBeenCalled(); expect(JSON.stringify(verbose.mock.calls)).not.toContain("private-sdk");
    } finally { verbose.mockRestore(); debugLog.mockRestore(); warning.mockRestore(); network.mockRestore(); }
  });

  it("preserves existing classification while exposing an additional Undici timeout name", async () => {
    vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("GEMINI_DEBUG", "true");
    const errors = vi.spyOn(console, "error").mockImplementation(() => {}), info = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnings = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      create.mockRejectedValue(Object.assign(new Error("private-message"), { name: "ConnectTimeoutError", code: "UND_ERR_CONNECT_TIMEOUT" }));
      expect(await createGeminiStrategyProvider({ ...config, maxAttempts: 1 }).generate(prompt))
        .toEqual({ success: false, code: "PROVIDER_UNAVAILABLE" });
      expect(JSON.parse(String(errors.mock.calls.at(-1)?.[1]))).toMatchObject({ error: { errorName: "ConnectTimeoutError",
        errorChain: [expect.objectContaining({ code: "UND_ERR_CONNECT_TIMEOUT" })] } });
    } finally { errors.mockRestore(); info.mockRestore(); warnings.mockRestore(); }
  });

  it("does not instantiate a request with missing credentials or invalid configuration", async () => {
    expect(await createGeminiStrategyProvider({ ...config, apiKey: "" }).generate(prompt))
      .toEqual({ success: false, code: "CONFIGURATION_ERROR" });
    expect(await createGeminiStrategyProvider({ ...config, maxAttempts: 50 }).generate(prompt))
      .toEqual({ success: false, code: "CONFIGURATION_ERROR" });
    expect(create).not.toHaveBeenCalled();
  });
});
