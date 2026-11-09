import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { readFileSync } from "node:fs";
import { createContext, Script } from "node:vm";

const { create } = vi.hoisted(() => ({ create: vi.fn<(request: unknown, options: unknown) => Promise<unknown>>() }));
vi.mock("server-only", () => ({}));
vi.mock("@google/genai", () => ({ GoogleGenAI: class { interactions = { create }; } }));
import { configuredDiscussionProvider, discussionProviderIdentity } from "../../src/features/campaign-strategist/configured-provider.server";
import { developmentEnabled, developmentProvider } from "../../src/features/campaign-strategist/development-provider";
import { generateCampaignStrategies } from "../../src/features/campaign-strategist/strategy-service";
import { StrategyAlternativeSchema } from "../../src/features/campaign-strategist/contracts";
import { SendDiscussionSchema } from "../../src/features/campaign-strategist/persistence-contracts";
import { configuredBlueprintProvider } from "../../src/features/campaign-blueprint/gemini.server";
import { developmentBlueprintProvider } from "../../src/features/campaign-blueprint/development-provider";
import { generateBlueprint } from "../../src/features/campaign-blueprint/blueprint-service";
import { CreateBlueprintCommandSchema } from "../../src/features/campaign-blueprint/workflow.server";
import { BlueprintPlanSchema } from "../../src/features/campaign-blueprint/contracts";
import { blueprintFixture } from "../fixtures/blueprint";

const env = { NODE_ENV: "test", CAMPAIGN_DISCUSSION_PROVIDER: "gemini", CAMPAIGN_DISCUSSION_CONTEXT: "seeded",
  CAMPAIGN_BLUEPRINT_PROVIDER: "gemini", GEMINI_API_KEY: "private-test-key", GEMINI_MODEL: "gemini-3.8-flash", GEMINI_TIMEOUT_MS: "60000" };
const completed = (value: unknown) => ({ id: "mock-real-transport-id", status: "completed", output_text: JSON.stringify(value) });
beforeEach(() => { create.mockReset(); });

describe("explicit development Gemini wiring (SDK mocked; no paid calls)", () => {
  it("requires a separate paid opt-in for Bruno real generation, while preserving Fake and read-only modes", () => {
    const source = readFileSync("bruno/campaign-lab/collection.bru", "utf8").match(/script:pre-request \{([\s\S]*?)\n\}/)?.[1];
    expect(source).toBeDefined();
    const run = (values: Record<string, string>, method = "POST") => new Script(source ?? "").runInContext(createContext({
      bru: { interpolate: (value: string) => value, getVar: (key: string) => values[key] },
      req: { getUrl: () => "http://localhost:3100/api/dev/discussions", getMethod: () => method, getBody: () => ({ action: "send" }) },
    }));
    expect(() => run({ confirmRealGemini: "true" })).toThrow(/allowPaidRequests/);
    expect(() => run({ confirmRealGemini: "true", allowPaidRequests: "true" })).not.toThrow();
    expect(() => run({ confirmFakeProviders: "true" })).not.toThrow();
    expect(() => run({ confirmRealGemini: "true" }, "GET")).not.toThrow();
    expect(() => run({ confirmFakeProviders: "true", confirmRealGemini: "true" })).toThrow(/Choose one/);
  });
  it("fails closed for production, missing key, embedding-as-text and fake-only scenarios", () => {
    expect(developmentEnabled({ ...env, NODE_ENV: "production" })).toBe(false);
    expect(() => discussionProviderIdentity({ ...env, NODE_ENV: "production" })).toThrow();
    for (const invalid of [{ GEMINI_API_KEY: "" }, { GEMINI_MODEL: "gemini-embedding-2" }, { GEMINI_TIMEOUT_MS: "NaN" }]) {
      expect(() => configuredDiscussionProvider("normal", { ...env, ...invalid })).toThrow();
      expect(() => configuredBlueprintProvider("valid", { ...env, ...invalid })).toThrow();
    }
    expect(() => configuredDiscussionProvider("failure", env)).toThrow("FAKE_SCENARIO_DISABLED");
    expect(() => configuredBlueprintProvider("invalid", env)).toThrow("FAKE_SCENARIO_DISABLED");
    expect(() => developmentProvider("normal", env)).toThrow();
    expect(() => developmentBlueprintProvider("valid", env)).toThrow();
    expect(create).not.toHaveBeenCalled();
  });

  it("accepts a natural Indonesian turn without scenario, validates C2/simulator, and preserves real transport provenance", async () => {
    const f = await blueprintFixture(); const proposal = f.input.selected.proposal;
    const command = SendDiscussionSchema.parse({ sessionId: proposal.sessionId, requestKey: "natural-question", expectedVersion: 1,
      expectedContextHash: proposal.contextHash, message: "Bagaimana mengingatkan calon pembeli tanpa menurunkan harga?", preferences: proposal.preferences });
    expect(command.scenario).toBe("normal");
    create.mockResolvedValue(completed({ schemaVersion: 1, contextHash: proposal.contextHash, reply: "Pengingat dapat dipertimbangkan.",
      sourceReferences: ["c1.preorder"], options: [StrategyAlternativeSchema.strip().parse(f.input.selected.alternative)], limitations: ["Hasil belum diketahui."] }));
    const { scenario, ...turn } = command;
    const result = await generateCampaignStrategies({ ...f.contextInput.scope, ...turn, history: [] }, {
      provider: configuredDiscussionProvider(scenario, env), loadContext: f.dependencies.loadContext, now: f.dependencies.now });
    expect(result).toMatchObject({ success: true, data: { model: env.GEMINI_MODEL, providerRequestId: "mock-real-transport-id",
      options: [{ computedScenario: { hypotheticalFinalUnitPriceIdr: 120000 } }] } });
    expect(create).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(create.mock.calls[0][0])).toContain(command.message);
  });

  it("generates a real-provider blueprint through existing schedule/financial guards while keeping synthetic context", async () => {
    const f = await blueprintFixture();
    const plan = await f.dependencies.provider.generate({ alternative: f.input.selected.alternative, edits: f.input.command.edits, now: f.dependencies.now() });
    create.mockResolvedValue(completed(plan));
    const result = await generateBlueprint(f.input, { ...f.dependencies, provider: configuredBlueprintProvider("valid", env) });
    expect(result).toMatchObject({ provider: "gemini", model: env.GEMINI_MODEL, providerRequestId: "mock-real-transport-id", synthetic: true,
      financial: { calculation: { hypotheticalFinalUnitPriceIdr: 120000 } } });
    const { sessionId, generationId, proposalVersion, proposalKey } = f.input.selected.source;
    expect(CreateBlueprintCommandSchema.parse({ selection: { sessionId, generationId, proposalVersion, proposalKey }, campaignId: f.input.campaign.id,
      requestId: f.input.command.requestId })).toBeDefined();
    const request = z.object({ response_format: z.object({ schema: z.object({ properties: z.object({ tasks: z.unknown() }) }) }) }).parse(create.mock.calls[0][0]);
    expect(request.response_format.schema.properties.tasks).toBeDefined();
  });

  it("moves a closing task placed exactly at the campaign end one minute earlier and sends the explicit schedule window", async () => {
    const f = await blueprintFixture();
    const plan = BlueprintPlanSchema.parse(await f.dependencies.provider.generate({ alternative: f.input.selected.alternative, edits: f.input.command.edits, now: f.dependencies.now() }));
    const { endsAt } = f.input.command.edits;
    create.mockResolvedValue(completed({ ...plan, tasks: plan.tasks.map((task, index) => index === 0 ? { ...task, dueAt: endsAt } : task) }));
    const output = z.object({ plan: BlueprintPlanSchema }).parse(await configuredBlueprintProvider("valid", env)
      .generate({ alternative: f.input.selected.alternative, edits: f.input.command.edits, now: f.dependencies.now() }));
    expect(output.plan.tasks[0].dueAt).toBe(new Date(Date.parse(endsAt) - 60_000).toISOString());
    const request = z.object({ input: z.string() }).parse(create.mock.calls[0][0]);
    expect(JSON.parse(request.input)).toMatchObject({ scheduleWindow: { latestDueAt: new Date(Date.parse(endsAt) - 60_000).toISOString() } });
  });

  it("accepts a completed stateless Blueprint without id and preserves explicit null provenance", async () => {
    const f = await blueprintFixture();
    const plan = await f.dependencies.provider.generate({ alternative: f.input.selected.alternative, edits: f.input.command.edits, now: f.dependencies.now() });
    create.mockResolvedValue({ status: "completed", output_text: JSON.stringify(plan) });
    const result = await generateBlueprint(f.input, { ...f.dependencies, provider: configuredBlueprintProvider("valid", env) });
    expect(result).toMatchObject({ provider: "gemini", model: env.GEMINI_MODEL, providerRequestId: null,
      contextHash: f.input.selected.proposal.contextHash, source: f.input.selected.source,
      revision: { requestId: f.input.command.requestId, requestHash: expect.stringMatching(/^[a-f0-9]{64}$/) } });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it.each([null, "", 42, "x".repeat(257)])("rejects malformed Blueprint interaction id %s", async id => {
    const f = await blueprintFixture(); create.mockResolvedValue({ id, status: "completed", output_text: "{}" });
    await expect(configuredBlueprintProvider("valid", env).generate({ alternative: f.input.selected.alternative, edits: f.input.command.edits, now: f.dependencies.now() }))
      .rejects.toMatchObject({ code: "INVALID_RESPONSE", status: 502 });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it.each([{ response: { status: "incomplete", output_text: "{}" }, code: "OUTPUT_TRUNCATED" },
    { response: { status: "failed", errors: [{ code: "SAFETY_BLOCKED" }] }, code: "PROVIDER_REFUSED" }])
    ("rejects unfinished or refused Blueprint interactions without inventing an id", async ({ response, code }) => {
      const f = await blueprintFixture(); create.mockResolvedValue(response);
      await expect(configuredBlueprintProvider("valid", env).generate({ alternative: f.input.selected.alternative, edits: f.input.command.edits, now: f.dependencies.now() }))
        .rejects.toMatchObject({ code }); expect(create).toHaveBeenCalledTimes(1);
    });

  it.each(["{invalid", JSON.stringify({ tasks: "invalid" })])("rejects invalid Blueprint JSON even without interaction id", async output_text => {
    const f = await blueprintFixture(); create.mockResolvedValue({ status: "completed", output_text });
    await expect(configuredBlueprintProvider("valid", env).generate({ alternative: f.input.selected.alternative, edits: f.input.command.edits, now: f.dependencies.now() }))
      .rejects.toMatchObject({ code: "INVALID_BLUEPRINT", status: 502 }); expect(create).toHaveBeenCalledTimes(1);
  });

  it("removes invalid Gemini caption sentences before the unchanged strict domain validation", async () => {
    const f = await blueprintFixture();
    const plan = await f.dependencies.provider.generate({ alternative: f.input.selected.alternative, edits: f.input.command.edits, now: f.dependencies.now() });
    const complete = z.record(z.string(), z.unknown()).parse(plan);
    const contents = z.array(z.record(z.string(), z.unknown())).parse(complete.contents);
    create.mockResolvedValue(completed({ ...complete, contents: contents.map(content => ({ ...content, body: "Diskon 99%" })) }));
    const body = await generateBlueprint(f.input, { ...f.dependencies, provider: configuredBlueprintProvider("valid", env) });
    expect(body.contents.map(content => content.body)).not.toContain("Diskon 99%");
    expect(body.contents[0].body).toBe("Preorder sudah dibuka. Cek harga dan jadwal pengambilan di tautan preorder.");
  });

  it("does not retry/fallback on a real failure and logs only safe classification/status", async () => {
    const log = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      create.mockRejectedValue({ status: 403, message: "private-test-key sensitive upstream body" });
      const f = await blueprintFixture();
      await expect(configuredBlueprintProvider("valid", env).generate({ alternative: f.input.selected.alternative,
        edits: f.input.command.edits, now: f.dependencies.now() })).rejects.toMatchObject({ code: "CONFIGURATION_ERROR", status: 503 });
      expect(create).toHaveBeenCalledTimes(1);
      expect(log.mock.calls).toContainEqual(["Gemini request failed", expect.objectContaining({ code: "CONFIGURATION_ERROR", model: env.GEMINI_MODEL, attempt: 1, httpStatus: 403 })]);
      expect(JSON.stringify(log.mock.calls)).not.toContain("private-test-key");
    } finally { log.mockRestore(); }
  });
});
