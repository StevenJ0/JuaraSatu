import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { buildBusinessContext } from "../../src/features/ai-context";
import { generateCampaignStrategies } from "../../src/features/campaign-strategist";
import { GeminiReplyEnvelopeSchema, StrategyAlternativeSchema, summarizeProposals, StrategyProposalSchema, type DiscussionInput, type StrategyProposal, type StrategyProvider } from "../../src/features/campaign-strategist/contracts";
import { createGeminiStrategyProvider } from "../../src/features/campaign-strategist/gemini.server";
import { createGeminiBlueprintProvider } from "../../src/features/campaign-blueprint/gemini.server";
import { generateBlueprint } from "../../src/features/campaign-blueprint/blueprint-service";
import { fingerprint, initialBlueprintEdits } from "../../src/features/campaign-blueprint/blueprint-domain";
import { BlueprintPlanSchema, CampaignBlueprintSchema, type CampaignRow, type PersistedSelection } from "../../src/features/campaign-blueprint/contracts";
import { z } from "zod";
import { geminiConfiguration, type GeminiEnvironment } from "../../src/lib/ai/gemini-json.server";
import { narrativeRejection, outcomeClaimRejection } from "../../src/lib/ai/narrative-safety";
import { contextFixture, freshContextInput } from "../fixtures/ai-context";

/**
 * Billable check of the configured AI provider (CosmosHub or Gemini) against synthetic preorder facts: three calls,
 * no database writes. Opt in with CAMPAIGN_AI_LIVE=1; regular test runs skip it.
 */
const live = process.env.CAMPAIGN_AI_LIVE === "1";
const REPORT_PATH = "node_modules/.cache/campaign-ai-live/laporan.txt";
/** Console output of passing tests is hidden by the reporter, so every line is also written to the report file. */
function log(...parts: unknown[]) {
  const line = parts.map((part) => typeof part === "string" ? part : JSON.stringify(part)).join(" ");
  console.log(line); appendFileSync(REPORT_PATH, `${line}\n`);
}
function providerEnvironment(): GeminiEnvironment {
  const file = Object.fromEntries(readFileSync(".env.local", "utf8").split(/\r?\n/).filter((line) => /^[A-Z_]+=/.test(line))
    .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1).replace(/^["']|["']$/g, "")]));
  return { GEMINI_API_KEY: file.GEMINI_API_KEY, GEMINI_MODEL: file.GEMINI_MODEL, GEMINI_BASE_URL: file.GEMINI_BASE_URL, GEMINI_TIMEOUT_MS: file.GEMINI_TIMEOUT_MS };
}
function report(label: string, proposal: StrategyProposal, startedAt: number) {
  log(`\n=== ${label} (${Math.round((Date.now() - startedAt) / 1000)} detik, model ${proposal.model})`);
  log("Balasan:", proposal.reply);
  for (const option of proposal.options) log(JSON.stringify({ title: option.title, lever: option.lever, audience: option.targetAudience,
    discountBps: option.offer.discountBps, units: option.assumedAdditionalUnits, costIdr: option.assumedPromotionCostIdr,
    tactics: option.tactics, hashtags: option.hashtags, hypothesis: option.hypothesis, contributionIdr: option.computedScenario.scenarioContributionIdr }, null, 2));
  if (proposal.rejectedOptions.length) log("Ditolak validasi:", JSON.stringify(proposal.rejectedOptions.map((option) => option.code)));
}
/** Field-level reasons for options rejected by the schema, from the raw provider answer. */
function optionIssues(text: string | undefined) {
  if (!text) return;
  const envelope = GeminiReplyEnvelopeSchema.safeParse(JSON.parse(text));
  if (!envelope.success) return;
  envelope.data.options.forEach((option, index) => {
    const parsed = StrategyAlternativeSchema.safeParse(option);
    if (parsed.success) log(`Opsi ${index} mentah: judul="${parsed.data.title}" hipotesis="${parsed.data.hypothesis}" langkah=${JSON.stringify(parsed.data.tactics)}`);
    if (parsed.success) log(`  kategori: hipotesis=${narrativeRejection(parsed.data.hypothesis, {}, true)}/${outcomeClaimRejection(parsed.data.hypothesis, true)}`, (parsed.data.tactics ?? []).map((tactic) => `${tactic.platform}=${outcomeClaimRejection(tactic.action, true)}`).join(" "));
    else log(`Opsi ${index} gagal schema:`, JSON.stringify(parsed.error.issues.slice(0, 10).map((issue) => ({ path: issue.path.join("."), message: issue.message }))),
      "\nNilai opsi:", JSON.stringify(option).slice(0, 1500));
  });
}

describe.skipIf(!live)("live campaign AI with the configured provider", () => {
  if (live) { mkdirSync("node_modules/.cache/campaign-ai-live", { recursive: true }); writeFileSync(REPORT_PATH, `Tes langsung Campaign AI ${new Date().toISOString()}\n`); }
  const contextInput = freshContextInput();
  const built = buildBusinessContext(contextInput);
  if (!built.success) throw new Error("Invalid context fixture");
  const env = providerEnvironment();
  const real = createGeminiStrategyProvider(geminiConfiguration(env, 2));
  const answers: string[] = [];
  // Keeps the raw answer so a rejected response can be explained instead of only reported as INVALID_RESPONSE.
  const provider: StrategyProvider = { generate: async (prompt) => { const result = await real.generate(prompt); if (result.success) answers.push(result.text); return result; } };
  const dependencies = { provider, loadContext: async () => structuredClone(contextInput), now: () => contextFixture.calculatedAt };
  function explain(code: string): never {
    const text = answers.at(-1);
    if (text === undefined) throw new Error(`Strategy failed before any answer: ${code}`);
    let json: unknown;
    try { json = JSON.parse(text); } catch { throw new Error(`Strategy failed (${code}): answer is not JSON. Start: ${text.slice(0, 400)}`); }
    const envelope = GeminiReplyEnvelopeSchema.safeParse(json);
    const options = (envelope.success ? envelope.data.options : []).map((option) => StrategyAlternativeSchema.safeParse(option));
    throw new Error(`Strategy failed (${code}). Envelope issues: ${JSON.stringify(envelope.success ? [] : envelope.error.issues.slice(0, 8))}. ` +
      `Option issues: ${JSON.stringify(options.flatMap((option) => option.success ? [] : option.error.issues.slice(0, 8)))}. Answer start: ${text.slice(0, 600)}`);
  }
  const base = { ...contextInput.scope, sessionId: "33333333-3333-4333-8333-333333333333", expectedVersion: 1, expectedContextHash: built.data.contextHash, history: [],
    preferences: { budgetCapIdr: 100_000, allowDiscount: true, channels: ["whatsapp", "instagram"], intake: { assets: ["instagram", "community", "past_buyers"],
      assetNotes: "Grup alumni sekitar 200 orang, Instagram 800 pengikut", targetBuyer: "Mahasiswa dan pekerja di sekitar kampus Tembalang",
      productStrength: "Porsi besar, bahan segar dimasak hari itu", suspectedCause: "unaware", dailyTime: "30_60m" } } } satisfies Omit<DiscussionInput, "requestKey" | "message">;
  let first: StrategyProposal | null = null;

  it("proposes exactly one grounded alternative from the owner's answers", async () => {
    const startedAt = Date.now();
    const result = await generateCampaignStrategies({ ...base, requestKey: "live-first", message: "Tolong susun strategi promosi supaya target preorder tercapai." }, dependencies);
    if (!result.success) explain(result.error.code);
    report("Usulan pertama", result.data, startedAt);
    optionIssues(answers.at(-1));
    expect(result.data.options).toHaveLength(1);
    expect(result.data.options[0].tactics?.length).toBeGreaterThan(0);
    first = result.data;
  }, 180_000);

  it("gives a different alternative when the owner asks for another one", async () => {
    if (!first) throw new Error("First proposal missing");
    const startedAt = Date.now();
    const result = await generateCampaignStrategies({ ...base, requestKey: "live-second", previousProposals: summarizeProposals([first]),
      message: "Usulan sebelumnya kurang cocok. Beri satu usulan lain dengan pendekatan atau platform yang berbeda." }, dependencies);
    if (!result.success) explain(result.error.code);
    report("Usulan kedua", result.data, startedAt);
    optionIssues(answers.at(-1));
    expect(result.data.options).toHaveLength(1);
    const [before] = summarizeProposals([first]); const [after] = summarizeProposals([result.data]);
    log("Berbeda dari usulan pertama:", before.lever !== after.lever || before.platforms.join() !== after.platforms.join());
  }, 180_000);

  it("turns the first alternative into a valid campaign plan", async () => {
    if (!first) throw new Error("First proposal missing");
    const proposal = StrategyProposalSchema.parse({ ...first, persistence: "saved" });
    const alternative = proposal.options[0];
    const selected: PersistedSelection = { proposal, alternative, source: { sessionId: base.sessionId, generationId: "44444444-4444-4444-8444-444444444444",
      messageId: "55555555-5555-4555-8555-555555555555", proposalVersion: proposal.proposalVersion, proposalKey: alternative.proposalKey, proposalHash: fingerprint(proposal) } };
    const edits = initialBlueprintEdits(selected);
    const campaign: CampaignRow = { id: "66666666-6666-4666-8666-666666666666", business_id: proposal.businessId, preorder_id: proposal.preorderId, name: edits.title,
      status: "draft", version: 1, active_blueprint_id: null, published_at: null, offer_type: alternative.offer.offerType, discount_bps: alternative.offer.discountBps,
      budget_cap_idr: edits.budgetCapIdr, target_additional_units: edits.targetAdditionalUnits, starts_at: edits.startsAt, ends_at: edits.endsAt };
    const startedAt = Date.now();
    const realBlueprint = createGeminiBlueprintProvider(env, 2);
    // Prints every generated task against the allowed window and channels, so a schedule rejection can be explained.
    const blueprintProvider: typeof realBlueprint = { ...realBlueprint, generate: async (input) => {
      const output = await realBlueprint.generate(input);
      log(`Jendela: preorder mulai ${contextInput.c1.status === "available" ? contextInput.c1.data.preorder.startsAt : "?"}, sekarang ${contextFixture.calculatedAt}, kampanye ${edits.startsAt} s/d ${edits.endsAt}, kanal ${edits.channels.join(",")}`);
      const planned = z.object({ plan: BlueprintPlanSchema }).safeParse(output);
      for (const task of planned.success ? planned.data.plan.tasks : []) log(`  rencana tugas: due ${task.dueAt} kanal ${task.channel ?? "other"} | ${task.title}`);
      return output;
    } };
    const body = await generateBlueprint({ campaign, selected, nextVersion: 1, activeVersion: null, command: { campaignId: campaign.id,
      requestId: "77777777-7777-4777-8777-777777777777", expectedCampaignVersion: 1, expectedBlueprintId: null, expectedBlueprintVersion: null, edits, scenario: "valid" } },
    { provider: blueprintProvider, loadContext: async () => structuredClone(contextInput), now: () => contextFixture.calculatedAt });
    log(`\n=== Rencana (${Math.round((Date.now() - startedAt) / 1000)} detik, model ${body.model})`);
    log("Tujuan:", body.goal);
    for (const task of body.tasks) log(`Tugas [${task.channel ?? "platform lain"}] ${task.title}: ${task.description}`);
    for (const content of body.contents) log(`Caption [${content.channel}/${content.type}] ${content.body}`);
    expect(CampaignBlueprintSchema.safeParse(body).success).toBe(true);
  }, 180_000);
});
