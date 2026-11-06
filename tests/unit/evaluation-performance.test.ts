import { afterEach, describe, expect, it, vi } from "vitest";
import { measureEvaluation, recordEvaluationTiming } from "../../src/features/campaign-evaluation/performance";
vi.mock("server-only", () => ({}));
import { createGeminiDebugTrace } from "../../src/lib/ai/gemini-debug.server";
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
describe("Evaluation performance diagnostics", () => {
  it.each(["production", "test"])("keeps timing logs disabled in %s", async environment => {
    vi.stubEnv("NODE_ENV", environment); vi.stubEnv("GEMINI_DEBUG", "true");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await expect(measureEvaluation("database", null, async () => "private-business-data", "facts")).resolves.toBe("private-business-data");
    expect(log).not.toHaveBeenCalled();
  });
  it("records success/failure durations with only safe correlation and operation metadata", async () => {
    vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("GEMINI_DEBUG", "true");
    const log = vi.spyOn(console, "log").mockImplementation(() => {}), requestId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    await expect(measureEvaluation("database", requestId, async () => ({ key: "private-value" }), "facts")).resolves.toEqual({ key: "private-value" });
    await expect(measureEvaluation("provider", requestId, async () => { throw Error("private-key"); })).rejects.toThrow("private-key");
    const rows = log.mock.calls.map(call => JSON.parse(String(call[1])));
    expect(rows[0]).toMatchObject({ phase: "database", requestId, success: true, operation: "facts", durationMs: expect.any(Number) });
    expect(rows[1]).toMatchObject({ phase: "provider", requestId, success: false });
    recordEvaluationTiming("validation", "private-untrusted-id", 1);
    expect(JSON.parse(String(log.mock.calls[2][1])).requestId).toBeNull();
    expect(JSON.stringify(log.mock.calls)).not.toContain("private-");
  });
  it("shares the internal Evaluation UUID with transport traces and filters phase/size metadata", () => {
    vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("GEMINI_DEBUG", "true");
    const log = vi.spyOn(console, "log").mockImplementation(() => {}), id = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    createGeminiDebugTrace(id).event("TRANSPORT", "STARTED", { transportPhase: "request_sent", transportMs: 12, inputBytes: 1008, schemaBytes: 1148,
      prompt: "private-prompt", token: "private-token", customer: "private-customer" });
    expect(JSON.parse(String(log.mock.calls[0][1]))).toMatchObject({ requestId: id, transportPhase: "request_sent", transportMs: 12, inputBytes: 1008, schemaBytes: 1148 });
    createGeminiDebugTrace(id).event("TRANSPORT", "STARTED", { transportPhase: "private-value" });
    expect(JSON.parse(String(log.mock.calls[1][1]))).not.toHaveProperty("transportPhase");
    expect(JSON.stringify(log.mock.calls)).not.toContain("private-");
  });
});
