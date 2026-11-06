import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createContext } from "node:vm";
import { z } from "zod";
import { executeScript, interpolate, noInferencePolicy } from "../../scripts/test-business-memory-e2e.mjs";
vi.mock("server-only", () => ({}));
import { configuredMemoryProvider } from "../../src/features/business-memory/gemini.server";
const root = "bruno/campaign-lab/07-Business-Memory/";
const cases = [
  ["03-Reject-failure-candidate.bru", 503, "MEMORY_PROVIDER_UNAVAILABLE"],
  ["04-Reject-invalid-candidate.bru", 502, "INVALID_MEMORY_OUTPUT"],
  ["05-Reject-missing_evidence-candidate.bru", 502, "INVALID_MEMORY_OUTPUT"],
] as const;
function block(file: string, name: string) {
  const text = readFileSync(root + file, "utf8"), marker = name + " {\n";
  const normalized = text.replace(/\r\n/g, "\n"), start = normalized.indexOf(marker);
  if (start < 0) throw Error("Missing Bruno block");
  return normalized.slice(start + marker.length, normalized.indexOf("\n}", start));
}
function assertions(file: string, real: boolean, status: number, code: string) {
  executeScript(block(file, "tests"), createContext({ bru: { getVar: () => real ? "true" : "false" },
    res: { getStatus: () => status, getBody: () => ({ code }) }, test: (_name: string, work: () => void) => work() }), file);
}
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe("Business Memory Bruno provider-mode contract", () => {
  it.each(cases)("retains Fake failure expectations in %s", (file, status, code) => {
    expect(() => assertions(file, false, status, code)).not.toThrow();
    expect(() => assertions(file, false, 400, "FAKE_SCENARIO_DISABLED")).toThrow();
  });
  it.each(cases)("accepts only the real-mode injection rejection in %s", file => {
    expect(() => assertions(file, true, 400, "FAKE_SCENARIO_DISABLED")).not.toThrow();
    expect(() => assertions(file, true, 200, "FAKE_SCENARIO_DISABLED")).toThrow();
    expect(() => assertions(file, true, 400, "INVALID_MEMORY_OUTPUT")).toThrow();
  });
  it.each(["failure", "invalid", "missing_evidence"] as const)("rejects real %s before any SDK HTTP request", scenario => {
    const fetcher = vi.fn<typeof fetch>(); vi.stubGlobal("fetch", fetcher);
    expect(() => configuredMemoryProvider(scenario, { NODE_ENV: "test", CAMPAIGN_MEMORY_PROVIDER: "gemini", GEMINI_API_KEY: "synthetic-key", GEMINI_MODEL: "gemini-3.6-flash" }))
      .toThrow("FAKE_SCENARIO_DISABLED");
    expect(fetcher).not.toHaveBeenCalled();
  });
});
describe("no-inference E2E runner", () => {
  const empty = { memories: [], jobs: [] };
  it.each(["failure", "invalid", "missing_evidence"])("allows only known guarded scenario %s", scenario => {
    expect(noInferencePolicy("POST", { action: "generate", scenario }, empty)).toBeNull();
  });
  it.each([
    [{ action: "generate", scenario: "valid" }, empty],
    [{ action: "generate", scenario: "valid", allowPaidRequests: true }, empty],
    [{ action: "generate", scenario: "failure" }, { memories: [{}], jobs: [] }],
    [{ action: "run_worker" }, { memories: [], jobs: [{}] }],
    [{ action: "retrieve" }, { memories: [{}], jobs: [] }],
    [{ action: "approve" }, empty],
  ])("blocks inference-capable or candidate-dependent action %s", (body, snapshot) => {
    expect(noInferencePolicy("POST", body, snapshot)).not.toBeNull();
  });
  it("allows empty worker/cold-start and reads", () => {
    expect(noInferencePolicy("POST", { action: "run_worker" }, empty)).toBeNull();
    expect(noInferencePolicy("POST", { action: "retrieve" }, empty)).toBeNull();
    expect(noInferencePolicy("GET", undefined, empty)).toBeNull();
  });
  it("resolves runtime variables and creates a genuine new internal UUID", () => {
    const variables = new Map([["campaignId", "example"]]);
    expect(interpolate("{{campaignId}}/{{unknown}}", variables)).toBe("example/{{unknown}}");
    expect(z.uuid().safeParse(interpolate("{{$randomUUID}}", variables)).success).toBe(true);
  });
  it("executes original draft/replay scripts preserving the original UUID without HTTP", () => {
    const variables = new Map([["allowMutations", "true"], ["sourceEvaluationId", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"], ["memorySourceHash", "a".repeat(64)], ["campaignId", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"]]);
    let body: unknown = block("06-Generate-persisted-draft.bru", "body:json");
    const context = createContext({ bru: { getVar: (key: string) => variables.get(key), setVar: (key: string, value: string) => variables.set(key, value),
      interpolate: (value: string) => interpolate(value, variables) }, req: { getBody: () => body, setBody: (value: unknown) => { body = value; } } });
    executeScript(block("06-Generate-persisted-draft.bru", "script:pre-request"), context, "draft pre");
    const original = structuredClone(body);
    executeScript(block("07-Replay-memory-generation.bru", "script:pre-request"), context, "replay pre");
    expect(body).toEqual(original);
    expect(noInferencePolicy("POST", body, empty)).not.toBeNull();
    expect(readFileSync(root + "06-Generate-persisted-draft.bru", "utf8")).toContain("timeout: 90000");
  });
});

import { mkdtempSync, readFileSync as readText, unlinkSync, rmdirSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifyLiveSafety, reserveLiveAttempt, decodeGeminiEvents } from "../../scripts/test-business-memory-e2e.mjs";
describe("one-shot live Memory runner", () => {
  const env = { CAMPAIGN_MEMORY_PROVIDER: "gemini", CAMPAIGN_MEMORY_RETRIEVAL: "gemini", GEMINI_MODEL: "gemini-3.6-flash", GEMINI_DEBUG: "true", GEMINI_API_KEY: "synthetic-private-key-ABCD" };
  const evidence = { projectName: "Tugas Akhir", projectId: "synthetic-project", billingTier: "Free tier", billingAction: "Set up billing", modelFreeTierConfirmed: true };
  it("requires matching non-secret key evidence and supported Free Tier configuration", () => {
    expect(verifyLiveSafety(env, evidence, "ABCD")).toBeNull();
    expect(verifyLiveSafety(env, evidence, "wrong")).toBe("KEY_PROJECT_MATCH_UNVERIFIED");
    expect(verifyLiveSafety(env, { ...evidence, projectId: null }, "ABCD")).toBe("KEY_PROJECT_MATCH_UNVERIFIED");
    expect(verifyLiveSafety(env, { ...evidence, billingTier: "Paid tier" }, "ABCD")).not.toBeNull();
    expect(verifyLiveSafety({ ...env, GEMINI_MODEL: "gemini-3.8-flash" }, evidence, "ABCD")).not.toBeNull();
  });
  it("durably consumes the allowance before dispatch and refuses a second reservation or interrupted file", () => {
    const directory = mkdtempSync(join(tmpdir(), "memory-live-budget-")), path = join(directory, "attempt.json");
    try {
      const command = { action: "generate", scenario: "valid", campaignId: "c8f2a641-9b73-4e02-a7d5-61c90b38f254",
        evaluationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", expectedContextHash: "a".repeat(64), requestId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" };
      const source = { evaluationId: command.evaluationId, contextHash: command.expectedContextHash, sourceVersion: 10, synthetic: true, productionEligible: false, developmentEligible: true };
      const reserved = reserveLiveAttempt(path, command, source, { ...evidence, apiKey: env.GEMINI_API_KEY, suffix: "ABCD" });
      const persisted = JSON.parse(readText(path, "utf8"));
      expect(persisted).toMatchObject({ consumedBeforeDispatch: true, command, sourceVersion: 10 });
      expect(persisted.requestBodyJson).toBe(JSON.stringify(command));
      expect(() => reserveLiveAttempt(path, command, source, evidence)).toThrow();
      expect(readText(path, "utf8")).not.toMatch(/synthetic-private-key|ABCD/);
      expect(reserved.command.requestId).toBe(command.requestId);
      writeFileSync(path, "{interrupted");
      expect(() => reserveLiveAttempt(path, command, source, evidence)).toThrow();
    } finally { if (existsSync(path)) unlinkSync(path); rmdirSync(directory); }
  });
  it("preserves source restrictions before consuming any allowance", () => {
    const path = join(tmpdir(), "unused-memory-budget-" + Date.now());
    expect(() => reserveLiveAttempt(path, { action: "generate", scenario: "valid", campaignId: "other" }, { synthetic: true }, evidence)).toThrow();
    expect(existsSync(path)).toBe(false);
  });
  it("permits idle/cold-start with only synthetic drafts, never approved/unknown Memory", () => {
    const snapshot = { jobs: [], memories: [{ reviewStatus: "draft", synthetic: true, productionEligible: false }] };
    expect(noInferencePolicy("POST", { action: "run_worker" }, snapshot)).toBeNull();
    expect(noInferencePolicy("POST", { action: "retrieve" }, snapshot)).toBeNull();
    expect(noInferencePolicy("POST", { action: "retrieve" }, { ...snapshot, memories: [{ ...snapshot.memories[0], reviewStatus: "approved" }] })).not.toBeNull();
  });
  it("decodes SDK status from nested Next logs without treating object previews as new invocations", () => {
    const event = { requestId: "synthetic-trace", stage: "SDK_REQUEST", result: "STARTED" };
    const line = JSON.stringify({ message: "[GEMINI_DEBUG] " + JSON.stringify(JSON.stringify(event)) });
    expect(decodeGeminiEvents(line)).toEqual([event]);
    expect(decodeGeminiEvents("unrelated private text")).toEqual([]);
  });
});
