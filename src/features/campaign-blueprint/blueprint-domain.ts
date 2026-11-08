import { createHash } from "node:crypto";
import { buildBusinessContext, type BuildBusinessContextInput } from "../ai-context";
import { revalidateStrategyProposal } from "../campaign-strategist";
import { simulateCampaign, SimulationResultSchema } from "../campaign-simulator";
import { BlueprintError, BlueprintEditsSchema, BlueprintPlanSchema, CampaignBlueprintSchema,
  type BlueprintEdits, type CampaignBlueprint, type PersistedSelection, type SourceVersionsSchema } from "./contracts";
import type { z } from "zod";
import { narrativeRejection, normalizeNarrative } from "@/lib/ai/narrative-safety";

export function fingerprint(value: unknown): string {
  function sorted(input: unknown): unknown {
    if (Array.isArray(input)) return input.map(sorted);
    if (input !== null && typeof input === "object") return Object.fromEntries(Object.entries(input).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => [key, sorted(value)]));
    return input;
  }
  return createHash("sha256").update(JSON.stringify(sorted(value))).digest("hex");
}
export function initialBlueprintEdits(selected: PersistedSelection): BlueprintEdits {
  const option = selected.alternative;
  return { title: option.title, marketingApproach: option.marketingApproach, discountBps: option.offer.discountBps,
    budgetCapIdr: option.assumedPromotionCostIdr, targetAdditionalUnits: option.assumedAdditionalUnits,
    startsAt: option.startsAt, endsAt: option.endsAt, channels: option.channels, notes: "" };
}
export function blueprintFacts(contextInput: BuildBusinessContextInput, now: string) {
  const built = buildBusinessContext({ ...contextInput, calculatedAt: now });
  if (!built.success || !built.data.preorder.isOrderIntakeOpen) throw new BlueprintError("CONTEXT_UNAVAILABLE", 503);
  return built.data;
}
export function validateSelectedProposal(selected: PersistedSelection, contextInput: BuildBusinessContextInput, now: string) {
  const persistedAlternative = selected.proposal.options.find((entry) => entry.proposalKey === selected.source.proposalKey);
  if (selected.proposal.persistence !== "saved" || selected.proposal.status !== "alternatives_available" ||
    selected.proposal.sessionId !== selected.source.sessionId || selected.proposal.proposalVersion !== selected.source.proposalVersion ||
    selected.alternative.proposalKey !== selected.source.proposalKey || !persistedAlternative ||
    fingerprint(persistedAlternative) !== fingerprint(selected.alternative) || fingerprint(selected.proposal) !== selected.source.proposalHash) {
    throw new BlueprintError("INVALID_PROPOSAL", 400);
  }
  const validated = revalidateStrategyProposal({ ...selected.proposal, options: [selected.alternative] }, contextInput, now);
  if (!validated.success) throw new BlueprintError("STALE_CONTEXT");
  return validated.data.options[0];
}
export function validateBlueprintOffer(rawEdits: unknown, contextInput: BuildBusinessContextInput, now: string) {
  const edits = BlueprintEditsSchema.parse(rawEdits); const context = blueprintFacts(contextInput, now);
  const offer = edits.discountBps === 0 ? { offerType: "normal_price", discountBps: 0 } as const
    : { offerType: "percent_discount", discountBps: edits.discountBps } as const;
  if ((edits.marketingApproach === "limited_discount") !== (offer.offerType === "percent_discount") ||
    Date.parse(edits.startsAt) >= Date.parse(edits.endsAt) || Date.parse(edits.startsAt) < Date.parse(context.preorder.startsAt) ||
    Date.parse(edits.endsAt) > Date.parse(context.preorder.endsAt) || Date.parse(edits.endsAt) > Date.parse(context.preorder.intakeCutoffAt) ||
    Date.parse(edits.endsAt) <= Date.parse(now)) throw new BlueprintError("INVALID_BLUEPRINT", 400);
  const source = context.metadata.sources.c1; const c8 = context.metadata.sources.c8;
  const result = simulateCampaign({ businessId: context.business.businessId, preorderId: context.preorder.preorderId,
    preorderItemId: context.preorder.preorderItemId, preorderName: context.preorder.preorderName, productName: context.product.name,
    preorderStatus: context.preorder.preorderStatus, startsAt: context.preorder.startsAt, endsAt: context.preorder.endsAt,
    intakeCutoffAt: context.preorder.intakeCutoffAt, baseUnitPriceIdr: context.preorder.baseUnitPriceIdr,
    variableCostIdr: context.product.variableCostIdr, costQuality: context.product.costQuality, orderableUnits: context.preorder.orderableUnits,
    currentOffer: { preorderId: context.preorder.preorderId, preorderItemId: context.preorder.preorderItemId,
      preorderItemVersion: c8.preorderItemVersion, offer: context.effectiveOffer.offer, unitPriceIdr: context.effectiveOffer.unitPriceIdr,
      offerVersion: c8.offerVersion, calculatedAt: c8.calculatedAt }, snapshot: source },
  { offer, assumedAdditionalUnits: edits.targetAdditionalUnits, assumedPromotionCostIdr: edits.budgetCapIdr });
  if (!result.success || !result.data.feasible) throw new BlueprintError("FINANCIAL_OR_CAPACITY_BLOCKER", 400);
  return { edits, context, offer, calculation: result.data };
}
export function validateBlueprint(blueprintInput: unknown, contextInput: BuildBusinessContextInput, now: string): CampaignBlueprint {
  const blueprint = CampaignBlueprintSchema.parse(blueprintInput);
  const edits: BlueprintEdits = { title: blueprint.campaignTitle, marketingApproach: blueprint.marketingApproach,
    discountBps: blueprint.offer.discountBps, budgetCapIdr: blueprint.budgetCapIdr, targetAdditionalUnits: blueprint.targetAdditionalUnits,
    startsAt: blueprint.executionWindow.startsAt, endsAt: blueprint.executionWindow.endsAt, channels: blueprint.channels, notes: blueprint.revision.notes };
  const facts = validateBlueprintOffer(edits, contextInput, now);
  if (blueprint.synthetic !== (facts.context.metadata.sources.c1.provenance === "development_fixture")) {
    throw new BlueprintError("INVALID_PROVENANCE");
  }
  if (blueprint.businessId !== facts.context.business.businessId || blueprint.preorderId !== facts.context.preorder.preorderId ||
    blueprint.contextHash !== facts.context.contextHash) throw new BlueprintError("STALE_CONTEXT");
  const current = facts.context.metadata.sources.c1;
  for (const key of ["preorderVersion", "preorderItemVersion", "productVersion", "capacityVersion"] as const) {
    if (blueprint.sourceVersions[key] !== current[key]) throw new BlueprintError("STALE_CONTEXT");
  }
  if (blueprint.offer.type !== facts.offer.offerType || blueprint.kpiPlan.target !== blueprint.targetAdditionalUnits) throw new BlueprintError("INVALID_BLUEPRINT", 400);
  const plan = BlueprintPlanSchema.strip().parse(blueprint);
  const narrative = [blueprint.campaignTitle, plan.goal, plan.hypothesis, plan.audienceHypothesis, plan.rationale,
    ...plan.risks, ...plan.dependencies, ...plan.ownerChecklist, ...blueprint.assumptions, blueprint.evaluationPlan,
    blueprint.kpiPlan.definition, blueprint.kpiPlan.baselineNote, blueprint.revision.notes,
    ...plan.tasks.flatMap(task => [task.title, task.description]), ...plan.contents.map(content => content.body)];
  if (narrative.some(text => narrativeRejection(text, { targetUnits: [blueprint.targetAdditionalUnits, facts.context.preorder.targetUnits],
    promotionBudgetIdr: [blueprint.budgetCapIdr], unitPriceIdr: [facts.context.preorder.baseUnitPriceIdr, facts.calculation.hypotheticalFinalUnitPriceIdr], discountBps: [facts.offer.discountBps] }, true))) throw new BlueprintError("INVALID_CONTENT", 400);
  for (const task of plan.tasks) if (!edits.channels.includes(task.channel) || Date.parse(task.dueAt) < Date.parse(facts.context.preorder.startsAt) || Date.parse(task.dueAt) >= Date.parse(edits.endsAt)) throw new BlueprintError("INVALID_SCHEDULE", 400);
  for (const content of plan.contents) if (!edits.channels.includes(content.channel) || /gratis|bundl|voucher|ongkir/iu.test(normalizeNarrative(content.body))) throw new BlueprintError("INVALID_CONTENT", 400);
  return { ...blueprint, financial: { frozenBasePriceIdr: facts.context.preorder.baseUnitPriceIdr, variableCostIdr: facts.context.product.variableCostIdr,
    costQuality: facts.context.product.costQuality, calculation: facts.calculation } };
}
export function sourceVersions(contextInput: BuildBusinessContextInput): z.infer<typeof SourceVersionsSchema> {
  if (contextInput.c1.status !== "available") throw new BlueprintError("CONTEXT_UNAVAILABLE", 503);
  const { preorderVersion, preorderItemVersion, productVersion, capacityVersion } = contextInput.c1.data.snapshot;
  return { preorderVersion, preorderItemVersion, productVersion, capacityVersion };
}

/** Approval and publication must compare stored estimates with freshly recalculated financials. */
export function revalidateBlueprintFinancials(body: CampaignBlueprint, context: BuildBusinessContextInput, now: string) {
  const validated = validateBlueprint(body, context, now);
  const numeric = SimulationResultSchema.omit({ snapshot: true, currentOffer: true }).strip();
  if (fingerprint(numeric.parse(validated.financial.calculation)) !== fingerprint(numeric.parse(body.financial.calculation)) ||
    validated.financial.frozenBasePriceIdr !== body.financial.frozenBasePriceIdr ||
    validated.financial.variableCostIdr !== body.financial.variableCostIdr || validated.financial.costQuality !== body.financial.costQuality) throw new BlueprintError("INVALID_BLUEPRINT", 400);
  return validated;
}
