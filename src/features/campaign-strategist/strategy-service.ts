import type { GeminiDebugStage } from "@/lib/ai/gemini-debug.server";
import { BuildBusinessContextInputSchema, buildBusinessContext, type CampaignContextV1 } from "../ai-context";
import { simulateCampaign } from "../campaign-simulator";
import {
  DiscussionInputSchema, GeminiReplyEnvelopeSchema, StrategyAlternativeSchema, StrategyProposalSchema,
  type DiscussionInput, type StrategyDependencies, type StrategyErrorCode, type StrategyProposal, type StrategyResult,
} from "./contracts";
import { buildStrategyPrompt } from "./prompt";
import { narrativeRejection, normalizeNarrative, type NarrativeFacts } from "@/lib/ai/narrative-safety";

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
function unsafeText(texts: string[], sources:string[], context:CampaignContextV1, facts: NarrativeFacts) {
  return texts.map(normalizeNarrative).some((text) =>
    narrativeRejection(text, facts, true) !== null ||
    /[\w.+-]+@[\w.-]+\.[a-z]{2,}|terbukti meningkatkan|(?:sudah|telah)\s+(?:di)?(?:publish|publikasikan|setujui|approve)/iu.test(text) ||
    /(?:berdasarkan|menurut|based on|according to).{0,80}(?:memori|memory|kampanye sebelumnya|previous campaign|past campaign)|pengalaman terdahulu|(?:memori|memory).{0,40}(?:menunjukkan|membuktikan|suggests|shows)/iu.test(text) && !(context.history.status==="available" && sources.some((s)=>s.startsWith("memory:"))));
}
function narrativeFacts(context: CampaignContextV1, preferences: DiscussionInput["preferences"]): NarrativeFacts {
  return { targetUnits: [context.preorder.targetUnits], promotionBudgetIdr: preferences.budgetCapIdr === null ? [] : [preferences.budgetCapIdr],
    unitPriceIdr: [context.preorder.baseUnitPriceIdr, context.effectiveOffer.unitPriceIdr], observedUnits: [context.preorder.paidUnits], discountBps: [context.effectiveOffer.offer.discountBps] };
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
    const option = parsed.data;
    if (keys.has(option.proposalKey)) { reject("INVALID_OPTION"); continue; }
    keys.add(option.proposalKey);
    if (!sourcesValid(option.sourceReferences, context)) { reject("SOURCE_MISMATCH"); continue; }
    if (unsafeText([option.title, option.hypothesis, ...option.assumptions, ...option.risks],option.sourceReferences,context,
      { ...narrativeFacts(context, preferences), targetUnits: [context.preorder.targetUnits, option.assumedAdditionalUnits], promotionBudgetIdr: [option.assumedPromotionCostIdr], discountBps: [option.offer.discountBps] })) { reject("UNSAFE_TEXT"); continue; }
    const discounted = option.offer.offerType === "percent_discount";
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
    options.push({ ...option, computedScenario: calculation.data });
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
    const reply = GeminiReplyEnvelopeSchema.safeParse(json);
    if (!reply.success) { debug?.issues(stage, reply.error, json); return fail("INVALID_RESPONSE"); }
    debug?.event(stage, "SUCCESS");
    stage = "DOMAIN_VALIDATION";
    if (reply.data.contextHash !== context.contextHash) return fail("STALE_CONTEXT");
    if (!sourcesValid(reply.data.sourceReferences, context)) return fail("INVALID_RESPONSE");
    if (unsafeText([reply.data.reply, ...reply.data.limitations],reply.data.sourceReferences,context,narrativeFacts(context, discussion.preferences))) return fail("UNSAFE_TEXT");
    const refreshed = await load();
    if (refreshed === null || refreshed.contextHash !== context.contextHash) return fail("STALE_CONTEXT");
    const validated = validateOptions(reply.data.options, refreshed, discussion.preferences, debug);
    debug?.event(stage, "SUCCESS", { acceptedOptions: validated.options.length, rejectedOptions: validated.rejectedOptions.length,
      domainCodes: validated.rejectedOptions.map(option => option.code) });
    const limitations = [
      ...reply.data.limitations,
      "Volume dan biaya promosi adalah asumsi, bukan prediksi atau jaminan penjualan.",
      "Proposal belum disimpan, dipilih, disetujui, atau dipublikasikan. Review pemilik dan validasi ulang wajib.",
    ];
    if (context.effectiveOffer.state === "active") limitations.push("Campaign saat ini masih aktif. Alternatif tidak mengganti offer aktif dan tidak boleh dipublikasikan bersamaan.");
    if (context.analytics.status !== "available") limitations.push("KPI tambahan belum tersedia; tidak ada angka aktual yang dibuat sebagai pengganti.");
    if (validated.options.length === 0) limitations.push("Tidak ada alternatif yang lolos seluruh guard server pada respons ini.");
    const proposalInput = {
      schemaVersion: 1, state: "proposed", persistence: "not_saved", requiresOwnerReview: true,
      status: validated.options.length > 0 ? "alternatives_available" : "no_valid_options",
      businessId: discussion.businessId, preorderId: discussion.preorderId, sessionId: discussion.sessionId,
      requestKey: discussion.requestKey, contextHash: refreshed.contextHash,
      preferences: discussion.preferences,
      proposalVersion: discussion.expectedVersion + 1, generatedAt: refreshed.calculatedAt,
      model: response.model, providerRequestId: response.requestId,
      reply: reply.data.reply, sourceReferences: reply.data.sourceReferences, ...validated, limitations,
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
  if(!sourcesValid(proposal.sourceReferences,context)||unsafeText([proposal.reply,...proposal.limitations],proposal.sourceReferences,context,narrativeFacts(context,proposal.preferences)))return failure("UNSAFE_TEXT");
  // Stored computed fields are discarded and recalculated, never trusted.
  const raw = proposal.options.map((option) => StrategyAlternativeSchema.strip().parse(option));
  const validated = validateOptions(raw, context, proposal.preferences);
  if (validated.rejectedOptions.length > 0) return failure("STALE_CONTEXT");
  return { success: true, data: { ...proposal, options: validated.options } };
}
