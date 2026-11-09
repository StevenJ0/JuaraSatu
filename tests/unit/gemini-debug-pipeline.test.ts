import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
vi.mock("server-only", () => ({}));
vi.mock("../../src/features/campaign-strategist/discussion-auth.server", () => ({
  DiscussionHttpError: class DiscussionHttpError extends Error { constructor(readonly status: number, readonly code: string) { super(code); } },
  authenticateDiscussion: async () => ({ user: {}, ownerUserId: scope.ownerUserId, businessId: scope.businessId }),
  checkWriteOrigin: () => {}, ownedSession: async () => scope, ownedPreorder: async () => {},
}));
vi.mock("../../src/features/campaign-strategist/development-context.server", () => ({ seededDevelopmentContext: () => async () => freshContextInput() }));
vi.mock("../../src/features/campaign-strategist/supabase-discussion-repository.server", () => ({ createSupabaseDiscussionRepository: () => repository }));
import { discussionPost } from "../../src/features/campaign-strategist/discussion-api.server";
import { fakeDiscussionRepository } from "../fixtures/fake-discussion-repository";
import { replyFixture } from "../fixtures/campaign-strategist";
import { contextFixture, freshContextInput } from "../fixtures/ai-context";

const scope = { ...contextFixture.scope, ownerUserId: "11111111-1111-4111-8111-111111111111", sessionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa7" };
let repository: ReturnType<typeof fakeDiscussionRepository>;
const transport = vi.fn<typeof fetch>();
const body = { action: "send", sessionId: scope.sessionId, requestKey: "debug-unit-request", expectedVersion: 1,
  expectedContextHash: replyFixture.contextHash, message: "private-prompt-marker", preferences: { budgetCapIdr: 50000, allowDiscount: true, channels: ["whatsapp", "instagram"] } };
function makeRepository(fail = false) { return fakeDiscussionRepository({ ownerUserId: scope.ownerUserId,
  session: { id: scope.sessionId, businessId: scope.businessId, preorderId: scope.preorderId, version: 1,
    contextHash: replyFixture.contextHash, status: "active", messages: [] } }, fail); }
function wire(output: string, status = "completed") { return Response.json({ id: "synthetic-debug-interaction", status,
  steps: [{ type: "model_output", content: [{ type: "text", text: output }] }] }); }
const send = () => discussionPost(new Request("http://localhost:3000/api/dev/discussions", { method: "POST", headers: {
  "Content-Type": "application/json", Authorization: "Bearer private-auth-marker", Cookie: "private-cookie-marker" }, body: JSON.stringify(body) }));
function events() { return [...vi.mocked(console.log).mock.calls, ...vi.mocked(console.error).mock.calls]
  .filter(call => call[0] === "[GEMINI_DEBUG]").map(call => z.object({ stage: z.string(), result: z.string(), requestId: z.uuid() }).passthrough().parse(JSON.parse(String(call[1])))); }

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date(contextFixture.calculatedAt));
  for (const [key, value] of Object.entries({ NODE_ENV: "development", GEMINI_DEBUG: "true", CAMPAIGN_DISCUSSION_PROVIDER: "gemini",
    CAMPAIGN_DISCUSSION_CONTEXT: "seeded", GEMINI_API_KEY: "synthetic-secret-key", GEMINI_MODEL: "gemini-3.8-flash", GEMINI_TIMEOUT_MS: "60000" })) vi.stubEnv(key, value);
  vi.spyOn(console, "log").mockImplementation(() => {}); vi.spyOn(console, "error").mockImplementation(() => {}); vi.spyOn(console, "warn").mockImplementation(() => {});
  repository = makeRepository(); transport.mockReset(); vi.stubGlobal("fetch", transport);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); });

describe("Bruno request checkpoints with real SDK and mocked HTTP/auth/repository", () => {
  it.each(["UND_ERR_CONNECT_TIMEOUT", "ENOTFOUND", "CERT_HAS_EXPIRED"])("identifies %s without inventing an upstream response", async code => {
    transport.mockRejectedValue(new TypeError("fetch failed private-error-marker", { cause: Object.assign(new Error("private-cause-marker"), { code }) }));
    const response = await send(); expect(response.status).toBeGreaterThanOrEqual(400);
    const log = events(); expect(log).toContainEqual(expect.objectContaining({ stage: "TRANSPORT", result: "FAILED",
      upstreamHttpResponse: "NO_UPSTREAM_HTTP_RESPONSE", responseReceived: false, error: expect.objectContaining({ causeCode: code }) }));
    expect(log).toContainEqual(expect.objectContaining({ stage: "END", failureStage: "TRANSPORT" }));
    expect(transport).toHaveBeenCalledTimes(1); expect(JSON.stringify(log)).not.toContain("private-");
  });

  it.each([400, 401, 403, 429, 500])("records HTTP %s and safe provider error information", async status => {
    transport.mockResolvedValue(Response.json({ error: { code: status, status: status >= 500 ? "UNAVAILABLE" : "INVALID_ARGUMENT",
      message: "response_format schema rejected private-body-marker" } }, { status, headers: { "Retry-After": "20", "Set-Cookie": "private-session-marker" } }));
    const response = await send(); expect(response.status).toBe(status === 429 ? 429 : 503);
    expect(events()).toContainEqual(expect.objectContaining({ stage: "UPSTREAM_HTTP", result: "FAILED", httpStatus: status, responseReceived: true }));
    expect(events()).toContainEqual(expect.objectContaining({ stage: "END", failureStage: "UPSTREAM_HTTP" }));
    expect(transport).toHaveBeenCalledTimes(1); expect(JSON.stringify(events())).not.toContain("private-");
    expect(await response.json()).toEqual({ success: false, code: status === 429 ? "PROVIDER_RATE_LIMITED" : status >= 500 ? "PROVIDER_UNAVAILABLE" : "CONFIGURATION_ERROR" });
  });

  it("shows a sanitized successful interaction and successful JSON/Zod/domain/persistence boundaries", async () => {
    transport.mockImplementation(async () => wire(JSON.stringify(replyFixture)));
    const response = await send(); expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, persisted: true, proposal: { state: "proposed", model: "gemini-3.8-flash" } });
    const log = events();
    for (const stage of ["API_REQUEST", "PROVIDER_CONFIGURATION", "PROVIDER_INITIALIZATION", "REQUEST_PREPARATION", "TRANSPORT", "UPSTREAM_HTTP",
      "INTERACTION_RESPONSE", "JSON_PARSE", "ZOD_VALIDATION", "DOMAIN_VALIDATION", "PERSISTENCE"])
      expect(log).toContainEqual(expect.objectContaining({ stage }));
    expect(log).toContainEqual(expect.objectContaining({ stage: "END", failureStage: null, result: "SUCCESS" }));
    expect(new Set(log.map(row => row.requestId)).size).toBe(1);
    expect(JSON.stringify(log)).not.toContain(replyFixture.reply); expect(JSON.stringify(log)).not.toContain("private-");
  });

  it("persists a validated stateless strategy without an interaction id using the existing nullable provenance contract", async () => {
    transport.mockResolvedValue(Response.json({ status: "completed",
      steps: [{ type: "model_output", content: [{ type: "text", text: JSON.stringify(replyFixture) }] }] }));
    const response = await send(); expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, persisted: true, replayed: false, proposal: { providerRequestId: null, model: "gemini-3.8-flash" } });
    const log = events();
    expect(log).toContainEqual(expect.objectContaining({ stage: "INTERACTION_RESPONSE", result: "SUCCESS" }));
    for (const stage of ["JSON_PARSE", "ZOD_VALIDATION", "DOMAIN_VALIDATION", "PERSISTENCE"])
      expect(log).toContainEqual(expect.objectContaining({ stage, result: "SUCCESS" }));
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("rejects invalid strategy JSON even when the stateless interaction has no id", async () => {
    transport.mockResolvedValue(Response.json({ status: "completed",
      steps: [{ type: "model_output", content: [{ type: "text", text: "{invalid" }] }] }));
    const response = await send(); expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ success: false, code: "INVALID_RESPONSE" });
    expect(events()).toContainEqual(expect.objectContaining({ stage: "END", failureStage: "JSON_PARSE" }));
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("distinguishes an incomplete interaction from a network failure", async () => {
    transport.mockImplementation(async () => wire("{}", "incomplete"));
    // A cut-off answer is a bad response (502), not an unavailable provider (503).
    const response = await send(); expect(response.status).toBe(502);
    expect(events()).toContainEqual(expect.objectContaining({ stage: "INTERACTION_RESPONSE", result: "FAILED", response: expect.objectContaining({ interactionStatus: "incomplete" }) }));
    expect(events()).toContainEqual(expect.objectContaining({ stage: "END", failureStage: "INTERACTION_RESPONSE" }));
  });

  it.each([
    ["{", "JSON_PARSE", "INVALID_RESPONSE"],
    [JSON.stringify({ ...replyFixture, reply: 42 }), "ZOD_VALIDATION", "INVALID_RESPONSE"],
    // Unsafe prose is now filtered sentence by sentence; an invented source reference still fails the whole answer.
    [JSON.stringify({ ...replyFixture, sourceReferences: ["memory:00000000-0000-4000-8000-000000000000"] }), "DOMAIN_VALIDATION", "INVALID_RESPONSE"],
  ])("distinguishes rejected AI output at %s", async (output, stage, code) => {
    transport.mockImplementation(async () => wire(output));
    const response = await send(); expect(response.status).toBe(502); expect(await response.json()).toEqual({ success: false, code });
    expect(events()).toContainEqual(expect.objectContaining({ stage, result: "FAILED" }));
    expect(events()).toContainEqual(expect.objectContaining({ stage: "END", failureStage: stage }));
    if (stage === "ZOD_VALIDATION") expect(events()).toContainEqual(expect.objectContaining({ stage, issueCount: 1,
      issues: [expect.objectContaining({ path: "reply", expected: "string", actualType: "number" })] }));
  });

  it("shows finalization failure after valid domain output without reporting a successful persistence", async () => {
    repository = makeRepository(true); transport.mockImplementation(async () => wire(JSON.stringify(replyFixture)));
    const response = await send(); expect(response.status).toBe(503); expect(await response.json()).toEqual({ success: false, code: "PERSISTENCE_UNAVAILABLE" });
    expect(events()).toContainEqual(expect.objectContaining({ stage: "DOMAIN_VALIDATION", result: "SUCCESS" }));
    expect(events()).toContainEqual(expect.objectContaining({ stage: "PERSISTENCE", result: "FAILED", persisted: false }));
    expect(events()).toContainEqual(expect.objectContaining({ stage: "END", failureStage: "PERSISTENCE" }));
  });

  it("does not call Gemini again for a completed idempotency replay", async () => {
    transport.mockImplementation(async () => wire(JSON.stringify(replyFixture)));
    expect((await send()).status).toBe(200); vi.mocked(console.log).mockClear(); vi.mocked(console.error).mockClear();
    const response = await send(); expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ replayed: true });
    expect(transport).toHaveBeenCalledTimes(1); expect(events()).toContainEqual(expect.objectContaining({ stage: "SDK_REQUEST", result: "SKIPPED", claimStatus: "completed" }));
  });

  it("distinguishes an already failed idempotency replay from a new provider failure", async () => {
    transport.mockResolvedValue(Response.json({ error: { code: 500, status: "UNAVAILABLE" } }, { status: 500 }));
    expect((await send()).status).toBe(503); vi.mocked(console.log).mockClear(); vi.mocked(console.error).mockClear();
    const response = await send(); expect(response.status).toBe(503); expect(await response.json()).toEqual({ success: false, code: "PROVIDER_UNAVAILABLE" });
    expect(transport).toHaveBeenCalledTimes(1); expect(events()).toContainEqual(expect.objectContaining({ stage: "SDK_REQUEST", result: "SKIPPED", claimStatus: "failed" }));
    expect(events()).toContainEqual(expect.objectContaining({ stage: "END", failureStage: "IDEMPOTENCY" }));
  });

  it("records provider refusal without exposing the refusal message", async () => {
    transport.mockResolvedValue(Response.json({ id: "blocked-test", status: "failed", steps: [], errors: [{ code: "SAFETY_BLOCKED", message: "private-refusal-text" }] }));
    const response = await send(); expect(response.status).toBe(503); expect(await response.json()).toEqual({ success: false, code: "PROVIDER_REFUSED" });
    expect(events()).toContainEqual(expect.objectContaining({ stage: "INTERACTION_RESPONSE", result: "FAILED", code: "PROVIDER_REFUSED" }));
    expect(JSON.stringify(events())).toContain("SAFETY_BLOCKED"); expect(JSON.stringify(events())).not.toContain("private-refusal-text");
  });

  it("disables all verbose output while keeping the same failure response", async () => {
    vi.stubEnv("GEMINI_DEBUG", "false"); transport.mockResolvedValue(Response.json({ error: { code: 500, status: "INTERNAL", message: "private-body-marker" } }, { status: 500 }));
    const response = await send(); expect(response.status).toBe(503); expect(await response.json()).toEqual({ success: false, code: "PROVIDER_UNAVAILABLE" });
    expect(events()).toEqual([]); expect(vi.mocked(console.warn).mock.calls.at(-1)).toEqual(["Gemini request failed", {
      code: "PROVIDER_UNAVAILABLE", model: "gemini-3.8-flash", attempt: 1, httpStatus: 500 }]);
  });
});
