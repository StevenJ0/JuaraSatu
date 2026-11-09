import { z } from "zod";
import type { BuildBusinessContextInput } from "../ai-context";
import { BlueprintError, BlueprintEditsSchema, BlueprintPlanSchema, CampaignBlueprintSchema, GeminiBlueprintResultSchema,
  type BlueprintProvider, type CampaignBlueprint, type CampaignRow, type PersistedSelection } from "./contracts";
import { fingerprint, sanitizeGeneratedPlan, sourceVersions, validateBlueprint, validateBlueprintOffer, validateSelectedProposal } from "./blueprint-domain";

export const RevisionCommandSchema = z.strictObject({ campaignId: z.uuid(), requestId: z.uuid(),
  expectedCampaignVersion: z.number().int().positive(), expectedBlueprintId: z.uuid().nullable(), expectedBlueprintVersion: z.number().int().positive().nullable(),
  edits: BlueprintEditsSchema, scenario: z.enum(["valid", "failure", "invalid"]).default("valid") }).refine((command) =>
    (command.expectedBlueprintId === null) === (command.expectedBlueprintVersion === null), "Parent ID/version must be supplied together");
export type RevisionCommand = z.infer<typeof RevisionCommandSchema>;
type BlueprintInput = { command: RevisionCommand; campaign: CampaignRow; selected: PersistedSelection; nextVersion: number; activeVersion: number | null };
type BlueprintDependencies = { provider?: BlueprintProvider; loadContext(): Promise<BuildBusinessContextInput>; now(): string };
export async function validateBlueprintPreflight(input: BlueprintInput, dependencies: BlueprintDependencies) {
  const { command, campaign, selected } = input;
  if (campaign.status !== "draft" || campaign.published_at !== null || campaign.id !== command.campaignId ||
    campaign.version !== command.expectedCampaignVersion || campaign.active_blueprint_id !== command.expectedBlueprintId || input.activeVersion !== command.expectedBlueprintVersion ||
    campaign.business_id !== selected.proposal.businessId || campaign.preorder_id !== selected.proposal.preorderId) throw new BlueprintError("VERSION_CONFLICT");
  if (campaign.name !== command.edits.title) throw new BlueprintError("CAMPAIGN_TITLE_READ_ONLY", 400);
  const contextInput = await dependencies.loadContext(); const now = dependencies.now();
  const alternative = validateSelectedProposal(selected, contextInput, now);
  const facts = validateBlueprintOffer(command.edits, contextInput, now);
  if (facts.edits.plan && command.expectedBlueprintId === null) throw new BlueprintError("VERSION_CONFLICT");
  return { contextInput, now, alternative, facts };
}
export async function generateBlueprint(input: BlueprintInput, dependencies: BlueprintDependencies): Promise<CampaignBlueprint> {
  const { command, campaign, selected } = input;
  const { contextInput, now, alternative, facts } = await validateBlueprintPreflight(input, dependencies);
  let plan: z.infer<typeof BlueprintPlanSchema>;
  let provenance: { model: string; providerRequestId: string | null } | undefined;
  const manual = facts.edits.plan !== undefined;
  if (facts.edits.plan) plan = facts.edits.plan;
  else try {
    if (!dependencies.provider) throw new BlueprintError("CONFIGURATION_ERROR", 503);
    const output = await dependencies.provider.generate({ alternative: { ...alternative,
      marketingApproach: facts.edits.marketingApproach, offer: facts.offer,
      assumedAdditionalUnits: facts.edits.targetAdditionalUnits, assumedPromotionCostIdr: facts.edits.budgetCapIdr,
      computedScenario: facts.calculation }, edits: facts.edits, now });
    if (dependencies.provider.kind === "gemini") {
      const result = GeminiBlueprintResultSchema.parse(output);
      plan = result.plan; provenance = { model: result.model, providerRequestId: result.providerRequestId };
    } else plan = BlueprintPlanSchema.parse(output);
  }
  catch (error) { if (error instanceof BlueprintError) throw error; throw new BlueprintError("INVALID_BLUEPRINT", 502); }
  if (!manual) plan = sanitizeGeneratedPlan(plan, facts.edits, facts);
  const requestHash = fingerprint({ ...command, source: selected.source });
  const blueprint = CampaignBlueprintSchema.parse({ ...plan, schemaVersion: 1, businessId: campaign.business_id,
    campaignId: campaign.id, preorderId: campaign.preorder_id, blueprintVersion: input.nextVersion, proposalVersion: selected.source.proposalVersion,
    source: selected.source, contextHash: facts.context.contextHash, sourceVersions: sourceVersions(contextInput), campaignTitle: facts.edits.title,
    marketingApproach: facts.edits.marketingApproach, offer: { type: facts.offer.offerType, discountBps: facts.offer.discountBps },
    executionWindow: { startsAt: facts.edits.startsAt, endsAt: facts.edits.endsAt }, budgetCapIdr: facts.edits.budgetCapIdr,
    targetAdditionalUnits: facts.edits.targetAdditionalUnits, channels: facts.edits.channels, primaryKpi: "paid_units_in_window",
    financial: { frozenBasePriceIdr: facts.context.preorder.baseUnitPriceIdr, variableCostIdr: facts.context.product.variableCostIdr,
      costQuality: facts.context.product.costQuality, calculation: facts.calculation },
    kpiPlan: { target: facts.edits.targetAdditionalUnits, definition: "Unit yang sudah dibayar selama periode kampanye setelah diterbitkan, tanpa klaim sebab-akibat.",
      baselineNote: "Angka awal dihitung saat kampanye diterbitkan.", actualMetrics: null },
    evaluationPlan: "Bandingkan unit yang dibayar selama kampanye, unit dari tautan kampanye, dan biaya yang tercatat, tanpa klaim sebab-akibat.",
    assumptions: ["Unit tambahan dan anggaran promosi adalah asumsi pemilik, bukan prediksi atau penjualan aktual.", "Kapasitas adalah kondisi saat ini, bukan slot yang sudah dipesan."],
    revision: { requestId: command.requestId, requestHash, expectedCampaignVersion: command.expectedCampaignVersion,
      parentBlueprintId: command.expectedBlueprintId, parentVersion: command.expectedBlueprintVersion, notes: command.edits.notes },
    provider: manual ? "manual" : provenance ? "gemini" : "development-fake-blueprint", ...provenance,
    synthetic: facts.context.metadata.sources.c1.provenance === "development_fixture",
  });
  return validateBlueprint(blueprint, await dependencies.loadContext(), dependencies.now());
}
