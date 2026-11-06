import { expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createGeminiStrategyProvider } from "../../src/features/campaign-strategist/gemini.server";
import { generateCampaignStrategies } from "../../src/features/campaign-strategist";
import { buildBusinessContext } from "../../src/features/ai-context";
import { calculateOrderPrice, calculateUnitPrice } from "../../src/features/pricing";
import { freshContextInput } from "../fixtures/ai-context";
import { discussionFixture } from "../fixtures/campaign-strategist";

// Explicit opt-in, one network attempt, only synthetic facts. Never part of test:unit.
it.skipIf(process.env.CAMPAIGN_GEMINI_SMOKE !== "1")("real Gemini structured strategy smoke", async () => {
  try { process.loadEnvFile(".env.local"); } catch { /* Environment may already be configured. */ }
  const input = freshContextInput();
  const now = new Date().toISOString();
  const instant = Date.parse(now);
  const startsAt = new Date(instant - 3_600_000).toISOString();
  const endsAt = new Date(instant + 2 * 86_400_000).toISOString();
  if (input.c1.status !== "available" || input.c6.status !== "available" || input.c8.status !== "available" ||
    input.c8.data.effectiveOffer.state !== "active") throw new Error("Invalid synthetic smoke fixture");
  input.calculatedAt = now;
  input.c1.data.snapshot.calculatedAt = now;
  input.c6.data.snapshot.calculatedAt = now;
  input.c8.data.snapshot.calculatedAt = now;
  Object.assign(input.c1.data.preorder, { startsAt, endsAt, intakeCutoffAt: endsAt,
    fulfillmentDate: new Date(instant + 3 * 86_400_000).toISOString().slice(0, 10) });
  Object.assign(input.c8.data.effectiveOffer.campaign, { startsAt, endsAt, publishedAt: startsAt });
  input.history = { status: "not_requested" };
  const context = buildBusinessContext(input);
  if (!context.success) throw new Error("Synthetic smoke context failed validation");
  const provider = createGeminiStrategyProvider({ apiKey: process.env.GEMINI_API_KEY,
    model: process.env.GEMINI_MODEL ?? "gemini-3.8-flash", maxAttempts: 1, timeoutMs: 30_000 });
  const transport: { elapsedMs: number; status?: number; errorName?: string; networkCode?: string }[] = [];
  const knownNetworkCodes = new Set(["UND_ERR_CONNECT_TIMEOUT", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN",
    "ECONNRESET", "ECONNREFUSED", "UND_ERR_SOCKET", "CERT_HAS_EXPIRED", "SELF_SIGNED_CERT_IN_CHAIN"]);
  const originalFetch = globalThis.fetch;
  const trace = vi.spyOn(globalThis, "fetch").mockImplementation(async (...args: Parameters<typeof fetch>) => {
    const started = Date.now();
    try {
      const response = await originalFetch(...args);
      transport.push({ elapsedMs: Date.now() - started, status: response.status });
      return response;
    } catch (error: unknown) {
      const cause: unknown = error instanceof Error ? error.cause : undefined;
      const networkCode = typeof cause === "object" && cause !== null && "code" in cause &&
        typeof cause.code === "string" && knownNetworkCodes.has(cause.code) ? cause.code : undefined;
      transport.push({ elapsedMs: Date.now() - started,
        errorName: error instanceof Error ? error.name : "UnknownError", networkCode });
      throw error;
    }
  });
  let result: Awaited<ReturnType<typeof generateCampaignStrategies>>;
  try {
    result = await generateCampaignStrategies({ ...discussionFixture, expectedContextHash: context.data.contextHash,
      message: "Berikan satu atau dua opsi hipotetis yang layak. Gunakan bahasa kualitatif tanpa angka dalam teks bebas.",
    }, { provider, loadContext: async () => structuredClone(input), now: () => new Date().toISOString() });
  } finally {
    trace.mockRestore();
    // No URLs, keys, headers, request bodies, raw responses or exception messages.
    console.log(JSON.stringify({ step: "strategy_transport", transport }));
  }
  if (!result.success) throw new Error(`Sanitized smoke failure: ${result.error.code}`);
  expect(result.data.options.length).toBeGreaterThan(0);
  expect(result.data.options.every((option) => option.computedScenario.feasible)).toBe(true);
  expect(result.data.persistence).toBe("not_saved");
  expect(result.data.state).toBe("proposed");
  expect(result.data.requiresOwnerReview).toBe(true);
  expect(result.data.contextHash).toBe(context.data.contextHash);
  for (const option of result.data.options) {
    const priceInput = { baseUnitPriceIdr: input.c1.data.preorder.baseUnitPriceIdr, offer: option.offer };
    const unit = calculateUnitPrice(priceInput);
    const order = calculateOrderPrice({ ...priceInput, quantity: option.assumedAdditionalUnits });
    if (!unit.success || !order.success) throw new Error("Provider alternative failed C2 validation");
    const cost = input.c1.data.product.variableCostIdr;
    if (cost === null) throw new Error("Synthetic fixture must have a known cost");
    expect(option.computedScenario.hypotheticalFinalUnitPriceIdr).toBe(unit.data.finalUnitPriceIdr);
    expect(option.computedScenario.scenarioRevenueIdr).toBe(order.data.totalIdr);
    expect(option.computedScenario.scenarioVariableCostIdr).toBe(cost * option.assumedAdditionalUnits);
    expect(option.computedScenario.scenarioContributionIdr)
      .toBe(order.data.totalIdr - cost * option.assumedAdditionalUnits - option.assumedPromotionCostIdr);
    expect(option.assumedAdditionalUnits).toBeLessThanOrEqual(input.c1.data.preorder.orderableUnits);
  }
  console.log(JSON.stringify({ provider: "gemini", model: result.data.model, feasibleOptions: result.data.options.length,
    state: result.data.state, persistence: result.data.persistence, synthetic: true }));
}, 40_000);
