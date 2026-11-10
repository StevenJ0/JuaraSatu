import { z } from "zod";
import type { GeminiDebugStage } from "@/lib/ai/gemini-debug.server";
import { BuildBusinessContextInputSchema, buildBusinessContext, type CampaignContextV1 } from "../ai-context";
import { simulateCampaign } from "../campaign-simulator";
import {
  DiscussionInputSchema, GeminiReplyEnvelopeSchema, StrategyAlternativeSchema, StrategyProposalSchema,
  type DiscussionInput, type StrategyAlternative, type StrategyDependencies, type StrategyErrorCode, type StrategyProposal, type StrategyResult,
} from "./contracts";
import { buildStrategyPrompt } from "./prompt";
import { plainText } from "@/lib/ai/plain-text";
import { keepSafeSentences, narrativeRejection, normalizeNarrative, outcomeClaimRejection, type NarrativeFacts } from "@/lib/ai/narrative-safety";

const NEUTRAL_REPLY = "Berikut alternatif promosi yang lolos pemeriksaan server. Tinjau angka di setiap alternatif sebelum memilih.";
const NO_OPTION_REPLY = "Belum ada alternatif promosi yang lolos pemeriksaan server untuk permintaan ini.";
const NEUTRAL_TITLES = { scheduled_reminder: "Pengingat jadwal preorder", value_content: "Konten keunggulan produk", limited_discount: "Diskon terbatas preorder" } as const;
const NEUTRAL_ASSUMPTION = "Jumlah pesanan tambahan adalah asumsi pemilik, bukan prediksi penjualan.";
const NEUTRAL_RISK = "Respons pembeli terhadap promosi belum dapat dipastikan.";
const DiscountedOfferSchema = z.object({ offer: z.object({ offerType: z.literal("percent_discount") }) });
const NEUTRAL_HYPOTHESIS = "Langkah di bawah mungkin membantu calon pembeli yang relevan mengetahui dan meninjau preorder ini. Hasilnya belum pasti.";

function withPlainText(option: StrategyAlternative): StrategyAlternative {
  return { ...option, title: plainText(option.title), hypothesis: plainText(option.hypothesis), assumptions: option.assumptions.map(plainText), risks: option.risks.map(plainText),
    ...(option.targetAudience === undefined ? {} : { targetAudience: plainText(option.targetAudience) }),
    ...(option.tactics === undefined ? {} : { tactics: option.tactics.map((tactic) => ({ ...tactic, action: plainText(tactic.action) })) }) };
}
function failure(code: StrategyErrorCode): StrategyResult {
  const message = code === "STALE_CONTEXT" ? "Fakta atau versi context telah berubah. Muat ulang dan validasi ulang secara eksplisit."
    : code === "NO_FEASIBLE_OPTIONS" ? "Preorder belum terbuka atau tidak memiliki slot yang dapat direncanakan."
      : "Diskusi belum menghasilkan proposal yang dapat digunakan. Periksa input atau ulangi setelah sumber/provider tersedia.";
  return { success: false, error: { code, message } };
}
function freshContext(raw: unknown, scope: { businessId: string; preorderId: string }, now: string) {
  const parsed = BuildBusinessContextInputSchema.safeParse(raw);
  if (!parsed.success || parsed.data.scope.businessId !== scope.businessId || parsed.data.scope.preorderId !== scope.preorderId) return null;
  const context = buildBusinessContext({ ...parsed.data, scope, calculatedAt: now });
  return context.success ? context.data : null;
}
function sourcesValid(sources: string[], context: CampaignContextV1) {
  return (!sources.includes("c6.preorder_metrics") || context.analytics.status === "available") && sources.every((s)=>!s.startsWith("memory:") || context.history.status==="available" && context.history.memories.some((m)=>`memory:${m.memoryId}`===s));
}
/** Contact, handle, proof, approval and ungrounded memory claims; numbers and outcome promises are checked by narrative safety. */
function extraClaim(text: string, sources: string[], context: CampaignContextV1) {
  // Handles (@akun) are blocked like emails: the model cannot verify an account exists or agreed to promote anything.
  return /[\w.+-]+@[\w.-]+\.[a-z]{2,}|(?<![\w.])@[\w.]{2,}|terbukti meningkatkan|(?:sudah|telah)\s+(?:di)?(?:publish|publikasikan|setujui|approve)/iu.test(text) ||
    /(?:berdasarkan|menurut|based on|according to).{0,80}(?:memori|memory|kampanye sebelumnya|previous campaign|past campaign)|pengalaman terdahulu|(?:memori|memory).{0,40}(?:menunjukkan|membuktikan|suggests|shows)/iu.test(text) && !(context.history.status==="available" && sources.some((s)=>s.startsWith("memory:")));
}
function unsafeSentence(value: string, sources: string[], context: CampaignContextV1, facts: NarrativeFacts) {
  const text = normalizeNarrative(value);
  return narrativeRejection(text, facts, true) !== null || extraClaim(text, sources, context);
}
/** Unsafe only because it quotes numbers: no promise, causal, revenue, execution, contact or memory claim. */
function onlyNumbersUnsafe(value: string, sources: string[], context: CampaignContextV1) {
  return outcomeClaimRejection(value, true) === null && !extraClaim(normalizeNarrative(value), sources, context);
}
/** Drops only the unsafe sentences; unsafe text never reaches the owner, but one sentence no longer discards a whole answer. */
function safeText(value: string, sources: string[], context: CampaignContextV1, facts: NarrativeFacts) {
  return keepSafeSentences(value, (sentence) => unsafeSentence(sentence, sources, context, facts));
}
function safeItems(values: string[], fallback: string, sources: string[], context: CampaignContextV1, facts: NarrativeFacts) {
  const kept = values.flatMap((value) => safeText(value, sources, context, facts) ?? []);
  return kept.length > 0 ? kept : [fallback];
}
function narrativeFacts(context: CampaignContextV1, preferences: DiscussionInput["preferences"]): NarrativeFacts {
  const { preorder } = context;
  return { targetUnits: [preorder.targetUnits, preorder.paidTargetGapUnits], promotionBudgetIdr: preferences.budgetCapIdr === null ? [] : [preferences.budgetCapIdr],
    unitPriceIdr: [preorder.baseUnitPriceIdr, context.effectiveOffer.unitPriceIdr], observedUnits: [preorder.paidUnits], discountBps: [context.effectiveOffer.offer.discountBps],
    capacityUnits: [preorder.quotaUnits, preorder.orderableUnits, ...(context.capacity ? [context.capacity.totalUnits, context.capacity.availableUnits] : [])] };
}
function withOptions(facts: NarrativeFacts, options: StrategyProposal["options"]): NarrativeFacts {
  return { ...facts,
    targetUnits: [...(facts.targetUnits ?? []), ...options.map((option) => option.assumedAdditionalUnits)],
    promotionBudgetIdr: [...(facts.promotionBudgetIdr ?? []), ...options.map((option) => option.assumedPromotionCostIdr)],
    unitPriceIdr: [...(facts.unitPriceIdr ?? []), ...options.map((option) => option.computedScenario.hypotheticalFinalUnitPriceIdr)],
    discountBps: [...(facts.discountBps ?? []), ...options.map((option) => option.offer.discountBps)] };
}
function safeReply(reply: string, limitations: string[], sources: string[], context: CampaignContextV1, facts: NarrativeFacts, hasOptions: boolean) {
  return { reply: safeText(plainText(reply), sources, context, facts) ?? (hasOptions ? NEUTRAL_REPLY : NO_OPTION_REPLY),
    limitations: limitations.flatMap((limitation) => safeText(plainText(limitation), sources, context, facts) ?? []) };
}
/**
 * A campaign takes effect when the owner publishes it, and SQL publish_campaign rejects a future starts_at.
 * So a future start becomes "now" and the end is capped at the preorder close; both are deterministic and idempotent,
 * which keeps re-validation of a stored proposal stable. Starts before the preorder or empty windows still fail below.
 */
function campaignWindow(option: { startsAt: string; endsAt: string }, context: CampaignContextV1) {
  const start = Date.parse(option.startsAt), end = Date.parse(option.endsAt), now = Date.parse(context.calculatedAt);
  const latestEnd = Math.min(Date.parse(context.preorder.endsAt), Date.parse(context.preorder.intakeCutoffAt));
  return { startsAt: start > now ? new Date(now).toISOString() : option.startsAt, endsAt: end > latestEnd ? new Date(latestEnd).toISOString() : option.endsAt };
}
function validateOptions(rawOptions: unknown[], context: CampaignContextV1, preferences: DiscussionInput["preferences"], debug?: StrategyDependencies["debug"]) {
  const options: StrategyProposal["options"] = [];
  const rejectedOptions: StrategyProposal["rejectedOptions"] = [];
  const keys = new Set<string>();
  for (const [index, raw] of rawOptions.entries()) {
    const parsed = StrategyAlternativeSchema.safeParse(raw);
    function reject(code: StrategyProposal["rejectedOptions"][number]["code"]) {
      debug?.event("DOMAIN_VALIDATION", "REJECTED", { optionIndex: index, domainCodes: [code] });
      rejectedOptions.push({ index, code, message: "Alternatif ditolak oleh validasi server; tidak dapat dipilih atau dipublikasikan." });
    }
    if (!parsed.success) { debug?.issues("ZOD_VALIDATION", parsed.error, raw, "REJECTED"); reject("INVALID_OPTION"); continue; }
    // Models sometimes write markdown; owners read these strings directly, so it is flattened before the safety checks.
    const option = { ...withPlainText(parsed.data), ...campaignWindow(parsed.data, context) };
    if (keys.has(option.proposalKey)) { reject("INVALID_OPTION"); continue; }
    keys.add(option.proposalKey);
    if (!sourcesValid(option.sourceReferences, context)) { reject("SOURCE_MISMATCH"); continue; }
    const discounted = option.offer.offerType === "percent_discount";
    if (option.lever === "price" && !discounted) { reject("INVALID_OPTION"); continue; }
    if ((option.marketingApproach === "limited_discount") !== discounted ||
      (discounted && !preferences.allowDiscount) ||
      (preferences.budgetCapIdr !== null && option.assumedPromotionCostIdr > preferences.budgetCapIdr) ||
      option.channels.some((channel) => !preferences.channels.includes(channel)) ||
      new Set(option.channels).size !== option.channels.length) { reject("PREFERENCE_CONFLICT"); continue; }
    const start = Date.parse(option.startsAt);
    const end = Date.parse(option.endsAt);
    if (start >= end || start < Date.parse(context.preorder.startsAt) ||
      end > Date.parse(context.preorder.endsAt) || end > Date.parse(context.preorder.intakeCutoffAt) ||
      end <= Date.parse(context.calculatedAt)) { reject("INVALID_DATES"); continue; }
    const current = context.effectiveOffer;
    const c8 = context.metadata.sources.c8;
    const calculation = simulateCampaign({
      businessId: context.business.businessId, preorderId: context.preorder.preorderId,
      preorderItemId: context.preorder.preorderItemId, preorderName: context.preorder.preorderName,
      productName: context.product.name, preorderStatus: context.preorder.preorderStatus,
      startsAt: context.preorder.startsAt, endsAt: context.preorder.endsAt, intakeCutoffAt: context.preorder.intakeCutoffAt,
      baseUnitPriceIdr: context.preorder.baseUnitPriceIdr, variableCostIdr: context.product.variableCostIdr,
      costQuality: context.product.costQuality, orderableUnits: context.preorder.orderableUnits,
      currentOffer: { preorderId: context.preorder.preorderId, preorderItemId: context.preorder.preorderItemId,
        preorderItemVersion: c8.preorderItemVersion, offer: current.offer, unitPriceIdr: current.unitPriceIdr,
        offerVersion: c8.offerVersion, calculatedAt: c8.calculatedAt },
      snapshot: { ...context.metadata.sources.c1, calculatedAt: context.calculatedAt },
    }, { offer: option.offer, assumedAdditionalUnits: option.assumedAdditionalUnits,
      assumedPromotionCostIdr: option.assumedPromotionCostIdr });
    if (!calculation.success || !calculation.data.feasible) { reject("FINANCIAL_OR_CAPACITY_BLOCKER"); continue; }
    const base = narrativeFacts(context, preferences);
    const facts: NarrativeFacts = { ...base, targetUnits: [...(base.targetUnits ?? []), option.assumedAdditionalUnits],
      promotionBudgetIdr: [option.assumedPromotionCostIdr], discountBps: [option.offer.discountBps],
      unitPriceIdr: [...(base.unitPriceIdr ?? []), calculation.data.hypotheticalFinalUnitPriceIdr] };
    const sources = option.sourceReferences;
    // Audience and tactics are optional extras: unsafe sentences are dropped and an emptied field is omitted.
    const { targetAudience: rawAudience, tactics: rawTactics, hashtags: rawHashtags, ...core } = option;
    const targetAudience = rawAudience === undefined ? null : safeText(rawAudience, sources, context, facts);
    const tactics = (rawTactics ?? []).flatMap((tactic) => { const action = safeText(tactic.action, sources, context, facts); return action === null ? [] : [{ ...tactic, action }]; });
    // The hypothesis is the reason to pick this alternative. A promise or other false claim discards the alternative;
    // a hypothesis lost only to quoted numbers is replaced when safe tactics still explain the plan.
    const safeHypothesis = safeText(option.hypothesis, sources, context, facts);
    const hypothesis = safeHypothesis ?? (tactics.length > 0 && onlyNumbersUnsafe(option.hypothesis, sources, context) ? NEUTRAL_HYPOTHESIS : null);
    if (hypothesis === null) { reject("UNSAFE_TEXT"); continue; }
    const title = unsafeSentence(option.title, sources, context, facts) ? NEUTRAL_TITLES[option.marketingApproach] : option.title;
    const hashtags = (rawHashtags ?? []).filter((tag) => !/pasti|jamin|gratis|voucher|ongkir/iu.test(tag));
    options.push({ ...core, ...(targetAudience ? { targetAudience } : {}), ...(tactics.length ? { tactics } : {}),
      ...(rawHashtags ? { hashtags } : {}), title, hypothesis, assumptions: safeItems(option.assumptions, NEUTRAL_ASSUMPTION, sources, context, facts).slice(0, 3),
      risks: safeItems(option.risks, NEUTRAL_RISK, sources, context, facts).slice(0, 3), computedScenario: calculation.data });
  }
  return { options, rejectedOptions };
}

export async function generateCampaignStrategies(input: unknown, dependencies: StrategyDependencies): Promise<StrategyResult> {
  const debug = dependencies.debug;
  let stage: GeminiDebugStage = "INPUT_VALIDATION";
  const fail = (code: StrategyErrorCode) => { debug?.event(stage, "FAILED", { code }); return failure(code); };
  const parsed = DiscussionInputSchema.safeParse(input);
  if (!parsed.success) { debug?.issues(stage, parsed.error, input); return fail("INVALID_INPUT"); }
  debug?.event(stage, "SUCCESS", { inputValidated: true });
  const discussion = parsed.data;
  try {
    const scope = { businessId: discussion.businessId, preorderId: discussion.preorderId };
    async function load() {
      try { return freshContext(await dependencies.loadContext(scope), scope, dependencies.now()); }
      catch { return null; }
    }
    stage = "CONTEXT_VALIDATION";
    const context = await load();
    if (context === null) return fail("CONTEXT_UNAVAILABLE");
    if (context.contextHash !== discussion.expectedContextHash) return fail("STALE_CONTEXT");
    if (!context.preorder.isOrderIntakeOpen || context.preorder.orderableUnits === 0) return fail("NO_FEASIBLE_OPTIONS");
    debug?.event(stage, "SUCCESS");
    stage = "REQUEST_PREPARATION";
    const prompt = buildStrategyPrompt(context, discussion);
    if (prompt.input.length > 40_000) return fail("INVALID_INPUT");
    stage = "SDK_REQUEST";
    const response = await dependencies.provider.generate(prompt);
    if (!response.success) return fail(response.code);
    if (response.text.length > 64_000) return fail("INVALID_RESPONSE");
    stage = "JSON_PARSE";
    let json: unknown;
    try { json = JSON.parse(response.text); } catch (error) { debug?.event(stage, "FAILED", { code: "INVALID_RESPONSE", error }); return fail("INVALID_RESPONSE"); }
    debug?.event(stage, "SUCCESS");
    stage = "ZOD_VALIDATION";
    // schemaVersion carries no information and some models drop it or send "1"; any other value is still rejected.
    if (typeof json === "object" && json !== null && !Array.isArray(json) && "contextHash" in json && (!("schemaVersion" in json) || json.schemaVersion === "1")) json = { ...json, schemaVersion: 1 };
    const reply = GeminiReplyEnvelopeSchema.safeParse(json);
    if (!reply.success) { debug?.issues(stage, reply.error, json); return fail("INVALID_RESPONSE"); }
    debug?.event(stage, "SUCCESS");
    stage = "DOMAIN_VALIDATION";
    if (reply.data.contextHash !== context.contextHash) return fail("STALE_CONTEXT");
    if (!sourcesValid(reply.data.sourceReferences, context)) return fail("INVALID_RESPONSE");
    const refreshed = await load();
    if (refreshed === null || refreshed.contextHash !== context.contextHash) return fail("STALE_CONTEXT");
    const options = reply.data.options.map((raw) => {
      if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return raw;
      let option: Record<string, unknown> = { ...raw };
      // Some models omit an option's sourceReferences; the answer-level ones were validated above and are re-checked per option.
      if (!("sourceReferences" in option)) option = { ...option, sourceReferences: reply.data.sourceReferences };
      // A percent discount has exactly one valid approach, so a mislabelled one is corrected; the offer itself is still validated.
      if (DiscountedOfferSchema.safeParse(option).success) option = { ...option, marketingApproach: "limited_discount" };
      return option;
    });
    const validated = validateOptions(options, refreshed, discussion.preferences, debug);
    debug?.event(stage, "SUCCESS", { acceptedOptions: validated.options.length, rejectedOptions: validated.rejectedOptions.length,
      domainCodes: validated.rejectedOptions.map(option => option.code) });
    const safe = safeReply(reply.data.reply, reply.data.limitations, reply.data.sourceReferences, refreshed,
      withOptions(narrativeFacts(refreshed, discussion.preferences), validated.options), validated.options.length > 0);
    const limitations = [
      ...safe.limitations,
      "Volume dan biaya promosi adalah asumsi, bukan prediksi atau jaminan penjualan.",
      "Proposal belum dipilih, disetujui, atau diterbitkan. Pemilik wajib meninjau sebelum memakai.",
    ];
    if (context.effectiveOffer.state === "active") limitations.push("Kampanye saat ini masih berjalan. Alternatif ini tidak mengganti penawaran yang aktif dan tidak bisa diterbitkan bersamaan.");
    if (context.analytics.status !== "available") limitations.push("Data penjualan tambahan belum tersedia, jadi tidak ada angka aktual yang dikarang sebagai pengganti.");
    if (validated.options.length === 0) limitations.push("Tidak ada alternatif yang lolos seluruh pemeriksaan server pada jawaban ini.");
    const proposalInput = {
      schemaVersion: 1, state: "proposed", persistence: "not_saved", requiresOwnerReview: true,
      status: validated.options.length > 0 ? "alternatives_available" : "no_valid_options",
      businessId: discussion.businessId, preorderId: discussion.preorderId, sessionId: discussion.sessionId,
      requestKey: discussion.requestKey, contextHash: refreshed.contextHash,
      preferences: discussion.preferences,
      proposalVersion: discussion.expectedVersion + 1, generatedAt: refreshed.calculatedAt,
      model: response.model, providerRequestId: response.requestId,
      reply: safe.reply, sourceReferences: reply.data.sourceReferences, ...validated, limitations,
    };
    const proposal = StrategyProposalSchema.safeParse(proposalInput);
    if (!proposal.success) { stage = "ZOD_VALIDATION"; debug?.issues(stage, proposal.error, proposalInput); return fail("INVALID_RESPONSE"); }
    return { success: true, data: proposal.data };
  } catch (error) { debug?.event(stage, "FAILED", { code: "PROVIDER_UNAVAILABLE", error }); return fail("PROVIDER_UNAVAILABLE"); }
}

/** Recompute explicitly against newly authorized facts; never approve/publish from a hash alone. */
export function revalidateStrategyProposal(proposalInput: unknown, contextInput: unknown, now: string): StrategyResult {
  const parsed = StrategyProposalSchema.safeParse(proposalInput);
  if (!parsed.success) return failure("INVALID_INPUT");
  const proposal = parsed.data;
  const context = freshContext(contextInput, proposal, now);
  if (context === null || context.contextHash !== proposal.contextHash) return failure("STALE_CONTEXT");
  if (!sourcesValid(proposal.sourceReferences, context)) return failure("UNSAFE_TEXT");
  // Stored computed fields are discarded and recalculated, never trusted.
  const raw = proposal.options.map((option) => StrategyAlternativeSchema.strip().parse(option));
  const validated = validateOptions(raw, context, proposal.preferences);
  if (validated.rejectedOptions.length > 0) return failure("STALE_CONTEXT");
  // Callers may pass only the selected alternative, so prose about the others is filtered rather than failing.
  const safe = safeReply(proposal.reply, proposal.limitations, proposal.sourceReferences, context,
    withOptions(narrativeFacts(context, proposal.preferences), validated.options), validated.options.length > 0);
  return { success: true, data: { ...proposal, reply: safe.reply, options: validated.options,
    limitations: safe.limitations.length > 0 ? safe.limitations : ["Volume dan biaya promosi adalah asumsi, bukan prediksi atau jaminan penjualan."] } };
}
