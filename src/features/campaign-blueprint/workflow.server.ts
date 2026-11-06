import "server-only";
import { z } from "zod";
import type { BuildBusinessContextInput } from "../ai-context";
import { BlueprintError, SelectionSchema, BlueprintScenarioSchema, CampaignBlueprintSchema, type CampaignBlueprint, type CampaignRow, type BlueprintProvider } from "./contracts";
import { fingerprint, initialBlueprintEdits, revalidateBlueprintFinancials, validateSelectedProposal } from "./blueprint-domain";
import { generateBlueprint, validateBlueprintPreflight, RevisionCommandSchema, type RevisionCommand } from "./blueprint-service";
import type { BlueprintRepository } from "./repository.server";

export const CreateBlueprintCommandSchema = z.strictObject({ selection: SelectionSchema, campaignId: z.uuid(), requestId: z.uuid(), scenario: BlueprintScenarioSchema.default("valid") });
export const ApproveBlueprintCommandSchema = z.strictObject({ campaignId: z.uuid(), blueprintId: z.uuid(), expectedBlueprintVersion: z.number().int().positive(),
  expectedCampaignVersion: z.number().int().positive(), confirm: z.literal(true) });
export function blueprintWorkflow(repository: BlueprintRepository, dependencies: { loadContext(scope: { businessId: string; preorderId: string }): Promise<BuildBusinessContextInput>;
  provider(scenario: z.infer<typeof BlueprintScenarioSchema>): BlueprintProvider; now(): string; approvalEnabled: boolean }) {
  async function response(campaignId: string, replayed: boolean, savedBlueprintId: string) {
    return { ...await repository.load(campaignId), replayed, savedBlueprintId };
  }
  async function generate(input: Parameters<typeof generateBlueprint>[0]) {
    const { command, campaign, selected } = input;
    if (campaign.status !== "draft" || campaign.version !== command.expectedCampaignVersion || campaign.active_blueprint_id !== command.expectedBlueprintId || input.activeVersion !== command.expectedBlueprintVersion) throw new BlueprintError("VERSION_CONFLICT");
    const deps = { loadContext: () => dependencies.loadContext(selected.proposal), now: dependencies.now };
    const hash = fingerprint({ ...command, source: selected.source });
    let body: CampaignBlueprint;
    if (command.edits.plan) body = await generateBlueprint(input, deps);
    else {
      await validateBlueprintPreflight(input, deps);
      const provider = dependencies.provider(command.scenario);
      const model = provider.kind === "gemini" ? provider.model : "development-fake-blueprint";
      if (!model) throw new BlueprintError("CONFIGURATION_ERROR", 503);
      body = await repository.generations.run({ type: "blueprint", requestKey: command.requestId, inputHash: hash, preorderId: selected.proposal.preorderId, model },
        CampaignBlueprintSchema, () => generateBlueprint(input, { ...deps, provider }));
    }
    if (body.campaignId !== campaign.id || body.revision.requestId !== command.requestId || body.revision.requestHash !== hash) throw new BlueprintError("INVALID_PROVENANCE");
    const context = await deps.loadContext();
    validateSelectedProposal(selected, context, dependencies.now());
    return revalidateBlueprintFinancials(body, context, dependencies.now());
  }
  return {
    async create(raw: unknown) {
      const input = CreateBlueprintCommandSchema.parse(raw); const selected = await repository.selection(input.selection);
      const edits = initialBlueprintEdits(selected);
      const command: RevisionCommand = { campaignId: input.campaignId, requestId: input.requestId, expectedCampaignVersion: 1,
        expectedBlueprintId: null, expectedBlueprintVersion: null, edits, scenario: input.scenario };
      const hash = fingerprint({ ...command, source: selected.source });
      const existing = await repository.replay(input.requestId, input.campaignId, hash);
      if (existing) return response(input.campaignId, true, existing.id);
      const virtual: CampaignRow = { id: input.campaignId, business_id: selected.proposal.businessId, preorder_id: selected.proposal.preorderId,
        name: edits.title, status: "draft", version: 1, active_blueprint_id: null, published_at: null,
        offer_type: selected.alternative.offer.offerType, discount_bps: edits.discountBps, budget_cap_idr: edits.budgetCapIdr,
        target_additional_units: edits.targetAdditionalUnits, starts_at: edits.startsAt, ends_at: edits.endsAt };
      const body = await generate({ command, campaign: virtual, selected, nextVersion: 1, activeVersion: null });
      const saved = await repository.create(body);
      return response(body.campaignId, saved.replayed, saved.row.id);
    },
    async revise(raw: unknown) {
      const command = RevisionCommandSchema.parse(raw);
      if (!command.expectedBlueprintId) throw new BlueprintError("VERSION_CONFLICT");
      const parent = await repository.blueprint(command.expectedBlueprintId);
      if (!parent || parent.campaign_id !== command.campaignId || parent.version !== command.expectedBlueprintVersion) throw new BlueprintError("VERSION_CONFLICT");
      const selected = await repository.selection(parent.blueprint_json.source);
      if (fingerprint(selected.source) !== fingerprint(parent.blueprint_json.source)) throw new BlueprintError("INVALID_PROVENANCE");
      const hash = fingerprint({ ...command, source: selected.source });
      const existing = await repository.replay(command.requestId, command.campaignId, hash);
      if (existing) return response(command.campaignId, true, existing.id);
      const loaded = await repository.load(command.campaignId);
      const body = await generate({ command, campaign: loaded.campaign, selected, nextVersion: (loaded.history[0]?.version ?? 0) + 1, activeVersion: loaded.active?.version ?? null });
      const saved = await repository.revise(body);
      return response(command.campaignId, saved.replayed, saved.row.id);
    },
    async approve(raw: unknown) {
      if (!dependencies.approvalEnabled) throw new BlueprintError("SYNTHETIC_APPROVAL_DISABLED", 503);
      const input = ApproveBlueprintCommandSchema.parse(raw); const loaded = await repository.load(input.campaignId);
      const active = loaded.active;
      if (!active || active.id !== input.blueprintId || active.version !== input.expectedBlueprintVersion || loaded.campaign.status !== "draft" || loaded.campaign.published_at !== null || active.approval_status === "discarded") throw new BlueprintError("VERSION_CONFLICT");
      const selected = await repository.selection(active.blueprint_json.source);
      if (fingerprint(selected.source) !== fingerprint(active.blueprint_json.source)) throw new BlueprintError("INVALID_PROVENANCE");
      const context = await dependencies.loadContext(selected.proposal); const now = dependencies.now();
      validateSelectedProposal(selected, context, now);
      revalidateBlueprintFinancials(active.blueprint_json, context, now);
      if (active.approval_status === "approved") return response(input.campaignId, true, active.id);
      if (loaded.campaign.version !== input.expectedCampaignVersion) throw new BlueprintError("VERSION_CONFLICT");
      await repository.approve(active.blueprint_json, active.id, loaded.campaign.version);
      return response(input.campaignId, false, active.id);
    },
  };
}
export function editsFromBlueprint(body: CampaignBlueprint) {
  return { title: body.campaignTitle, marketingApproach: body.marketingApproach, discountBps: body.offer.discountBps,
    budgetCapIdr: body.budgetCapIdr, targetAdditionalUnits: body.targetAdditionalUnits, startsAt: body.executionWindow.startsAt,
    endsAt: body.executionWindow.endsAt, channels: body.channels, notes: "" };
}
