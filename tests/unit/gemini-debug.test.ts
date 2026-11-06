import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
vi.mock("server-only", () => ({}));
import { createGeminiDebugTrace, errorDiagnostics } from "../../src/lib/ai/gemini-debug.server";

beforeEach(() => { vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("GEMINI_DEBUG", "true"); vi.spyOn(console, "log").mockImplementation(() => {}); vi.spyOn(console, "error").mockImplementation(() => {}); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe("development-only Gemini trace privacy", () => {
  it("logs actual dispatcher invocation with its budget and excludes unrelated secret fields", () => {
    createGeminiDebugTrace().event("TRANSPORT", "STARTED", { dispatcherInvoked: true, connectTimeoutMs: 30_000, apiKey: "private-key", prompt: "private-prompt" });
    const calls = vi.mocked(console.log).mock.calls;
    expect(JSON.parse(String(calls[0][1]))).toMatchObject({ stage: "TRANSPORT", dispatcherInvoked: true, connectTimeoutMs: 30_000 });
    expect(JSON.stringify(calls)).not.toContain("private-");
  });

  it.each([["production", "true"], ["test", "true"], ["development", "false"], ["development", "TRUE"], ["development", ""]])("does not emit verbose logs in %s with flag %s", (environment, flag) => {
    vi.stubEnv("NODE_ENV", environment); vi.stubEnv("GEMINI_DEBUG", flag);
    const trace = createGeminiDebugTrace();
    trace.event("TRANSPORT", "FAILED", { error: new Error("private-error"), transportInvoked: true, responseReceived: false });
    const invalid = z.string().safeParse(42); if (!invalid.success) trace.issues("ZOD_VALIDATION", invalid.error, 42);
    trace.end(503, "PROVIDER_UNAVAILABLE");
    expect(console.log).not.toHaveBeenCalled(); expect(console.error).not.toHaveBeenCalled();
  });

  it("redacts all response scalar values, unknown keys and sensitive headers while preserving schema shape", () => {
    const trace = createGeminiDebugTrace();
    trace.event("INTERACTION_RESPONSE", "SUCCESS", { response: { id: "private-interaction-id", model: "gemini-private-token", status: "completed",
      output_text: JSON.stringify({ schemaVersion: 1, reply: "private-business-name", options: [{ title: "private-title", assumedAdditionalUnits: 123456 }],
        apiKey: "private-api-key", cookie: "private-cookie", "private-field-name": "private-value" }),
      steps: [{ type: "model_output", content: [{ type: "text", text: "private-output" }] }] },
      headers: new Headers({ Authorization: "Bearer private-auth", Cookie: "private-cookie", "set-cookie": "private-session", "content-type": "application/json", "retry-after": "20" }) });
    const text = JSON.stringify(vi.mocked(console.log).mock.calls);
    expect(text).toContain("schemaVersion"); expect(text).toContain("assumedAdditionalUnits"); expect(text).toContain("PARSED");
    expect(text).toContain("application/json"); expect(text).toContain("redacted");
    expect(text).not.toContain("private-"); expect(text).not.toContain("123456");
    const row = z.object({ response: z.object({ interactionIdHash: z.string(), jsonPreview: z.string().max(4096), outputContentTypes: z.array(z.string()) }) }).parse(JSON.parse(String(vi.mocked(console.log).mock.calls[0][1])));
    expect(row.response.outputContentTypes).toEqual(["text"]); expect(row.response.interactionIdHash).toHaveLength(16);
  });

  it("logs validation paths, constraints and actual types without values or custom messages", () => {
    const input = { options: [{ title: 12345, assumedAdditionalUnits: 0 }] };
    const parsed = z.object({ options: z.array(z.object({ title: z.string(), assumedAdditionalUnits: z.number().min(1) })) }).safeParse(input);
    if (parsed.success) throw Error("Expected validation failure");
    const trace = createGeminiDebugTrace(); trace.issues("ZOD_VALIDATION", parsed.error, input); trace.end(502, "INVALID_RESPONSE");
    const details = z.object({ issueCount: z.number(), issues: z.array(z.object({ path: z.string(), actualType: z.string() })) }).parse(JSON.parse(String(vi.mocked(console.error).mock.calls[0][1])));
    expect(details.issueCount).toBe(2); expect(details.issues).toContainEqual(expect.objectContaining({ path: "options.0.title", actualType: "number" }));
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("12345");
    expect(JSON.parse(String(vi.mocked(console.error).mock.calls.at(-1)?.[1]))).toMatchObject({ stage: "END", failureStage: "ZOD_VALIDATION" });
  });

  it("bounds causes and validation issue counts and preserves a nested connection timeout", () => {
    const cause: { name: string; code: string; cause?: unknown } = { name: "Error", code: "UND_ERR_CONNECT_TIMEOUT" }; cause.cause = cause;
    const diagnostic = errorDiagnostics(new TypeError("private-cause", { cause }));
    expect(diagnostic.causeCode).toBe("UND_ERR_CONNECT_TIMEOUT"); expect(diagnostic.errorChain).toHaveLength(6);
    const schema = z.array(z.string()), input = Array.from({ length: 100 }, () => 12345), parsed = schema.safeParse(input);
    if (parsed.success) throw Error("Expected invalid input");
    createGeminiDebugTrace().issues("ZOD_VALIDATION", parsed.error, input);
    expect(JSON.parse(String(vi.mocked(console.error).mock.calls[0][1]))).toMatchObject({ issueCount: 100, truncated: true, issues: expect.any(Array) });
    const row = z.object({ issues: z.array(z.unknown()) }).parse(JSON.parse(String(vi.mocked(console.error).mock.calls[0][1]))); expect(row.issues).toHaveLength(20);
  });

  it("summarizes SDK error response categories and fields without raw upstream messages", () => {
    const error = Object.assign(new Error("private-key private-body"), { status: 400,
      error: { code: 400, status: "INVALID_ARGUMENT", message: "private-key response_format schema rejected",
        details: [{ fieldViolations: [{ field: "generation_config.max_output_tokens", description: "private-input" }, { field: "private-field-name", description: "private-business" }] }] } });
    const trace = createGeminiDebugTrace(); trace.event("UPSTREAM_HTTP", "FAILED", { error, httpStatus: 400 });
    const text = JSON.stringify(vi.mocked(console.error).mock.calls);
    expect(text).toContain("INVALID_ARGUMENT"); expect(text).toContain("REQUEST_SCHEMA_REJECTED"); expect(text).toContain("generation_config.max_output_tokens");
    expect(text).not.toContain("private-");
  });

  it("keeps simultaneous trace IDs distinct and prints the explicit missing-response marker", async () => {
    const first = createGeminiDebugTrace(), second = createGeminiDebugTrace();
    await Promise.all([Promise.resolve().then(() => first.event("TRANSPORT", "FAILED", { responseReceived: false })),
      Promise.resolve().then(() => second.event("TRANSPORT", "FAILED", { responseReceived: false }))]);
    const parse = z.object({ requestId: z.uuid(), upstreamHttpResponse: z.literal("NO_UPSTREAM_HTTP_RESPONSE") });
    const rows = vi.mocked(console.error).mock.calls.map(call => parse.parse(JSON.parse(String(call[1]))));
    expect(rows[0].requestId).not.toBe(rows[1].requestId);
  });
});
