import { z } from "zod";
import type { BuildBusinessContextInput } from "../ai-context";
import { BlueprintError, revalidateBlueprintFinancials, validateSelectedProposal } from "../campaign-blueprint";
import type { PersistedSelection } from "../campaign-blueprint/contracts";
import { supabaseUtcTimestamp } from "@/lib/supabase/timestamps";
import { CampaignExecutionError, PublishCampaignCommandSchema, CloseCampaignCommandSchema, TaskCommandSchema, PublicationBaselineSchema,
  type ExecutionSnapshot, type PublishCampaignCommand } from "./contracts";
import { assertMaterializedPlan, executionCalendar, projectPublishedOffer, taskUpdateDisposition } from "./projections";
import type { ExecutionRepository } from "./repository.server";

export function validateCampaignPublication(snapshot: ExecutionSnapshot, command: PublishCampaignCommand, selected: PersistedSelection, context: BuildBusinessContextInput, now: string) {
  const c = snapshot.campaign; const bp = snapshot.blueprint;
  if (c.status !== "draft" || c.published_at || c.id !== command.campaignId) throw new CampaignExecutionError("INVALID_CAMPAIGN_STATE");
  if (!bp || bp.approval_status !== "approved" || !bp.approved_at || !bp.approved_by_user_id) throw new CampaignExecutionError("BLUEPRINT_NOT_APPROVED");
  if (c.version !== command.expectedCampaignVersion || bp.id !== command.blueprintId || bp.version !== command.expectedBlueprintVersion || c.active_blueprint_id !== bp.id) throw new CampaignExecutionError("VERSION_CONFLICT");
  const b = bp.blueprint_json;
  if (command.expectedContextHash !== bp.context_hash || b.contextHash !== bp.context_hash) throw new CampaignExecutionError("STALE_CONTEXT");
  if (selected.source.messageId !== b.source.messageId || selected.source.proposalHash !== b.source.proposalHash ||
    selected.proposal.businessId !== c.business_id || selected.proposal.preorderId !== c.preorder_id) throw new CampaignExecutionError("INVALID_PROVENANCE");
  validateSelectedProposal(selected, context, now); revalidateBlueprintFinancials(b, context, now); assertMaterializedPlan(snapshot);
  if (c.offer_type !== b.offer.type || c.discount_bps !== b.offer.discountBps || c.marketing_approach !== b.marketingApproach || c.budget_cap_idr !== b.budgetCapIdr ||
    c.target_additional_units !== b.targetAdditionalUnits || c.primary_kpi !== b.primaryKpi ||
    supabaseUtcTimestamp(c.starts_at) !== supabaseUtcTimestamp(b.executionWindow.startsAt) || supabaseUtcTimestamp(c.ends_at) !== supabaseUtcTimestamp(b.executionWindow.endsAt) ||
    snapshot.preorder.id !== c.preorder_id || snapshot.preorder.business_id !== c.business_id || snapshot.item.preorder_id !== c.preorder_id || snapshot.item.business_id !== c.business_id ||
    snapshot.item.base_price_snapshot_idr !== b.financial.frozenBasePriceIdr) throw new CampaignExecutionError("INVALID_CAMPAIGN_CONFIGURATION");
  if (Date.parse(c.starts_at) > Date.parse(now) || Date.parse(c.ends_at) <= Date.parse(now) ||
    Date.parse(c.ends_at) > Date.parse(`${snapshot.preorder.fulfillment_date}T23:59:59.999+07:00`)) throw new CampaignExecutionError("CAMPAIGN_WINDOW_INVALID");
  return snapshot;
}
export function campaignExecutionService(repository: ExecutionRepository, dependencies: {
  selection(source: PersistedSelection["source"]): Promise<PersistedSelection>;
  loadContext(scope: { businessId: string; preorderId: string }): Promise<BuildBusinessContextInput>;
  now(): string; publishingEnabled: boolean;
  databaseError(error: unknown): never;
}) {
  const scope = (s: ExecutionSnapshot) => ({ businessId: s.campaign.business_id, preorderId: s.campaign.preorder_id });
  async function inspect(snapshot: ExecutionSnapshot, command: PublishCampaignCommand) {
    if (!dependencies.publishingEnabled) throw new CampaignExecutionError("SYNTHETIC_PUBLISHING_DISABLED", 503);
    if (!snapshot.blueprint || snapshot.blueprint.approval_status !== "approved") throw new CampaignExecutionError("BLUEPRINT_NOT_APPROVED");
    if (snapshot.campaign.status !== "draft") throw new CampaignExecutionError("INVALID_CAMPAIGN_STATE");
    if (await repository.conflicting(snapshot.campaign.preorder_id, snapshot.campaign.id)) throw new CampaignExecutionError("CAMPAIGN_CONFLICT");
    const source = await dependencies.selection(snapshot.blueprint.blueprint_json.source);
    let context: BuildBusinessContextInput;
    try { context = await dependencies.loadContext(scope(snapshot)); }
    catch (error) { if (await repository.conflicting(snapshot.campaign.preorder_id, snapshot.campaign.id)) throw new CampaignExecutionError("CAMPAIGN_CONFLICT"); throw error; }
    return validateCampaignPublication(snapshot, command, source, context, dependencies.now());
  }
  function publishReplay(snapshot: ExecutionSnapshot, command: PublishCampaignCommand) {
    const base = PublicationBaselineSchema.safeParse(snapshot.campaign.baseline_json);
    return snapshot.campaign.status === "published" && snapshot.campaign.published_blueprint_id === command.blueprintId && snapshot.blueprint?.version === command.expectedBlueprintVersion &&
      snapshot.blueprint.context_hash === command.expectedContextHash && base.success && base.data.sourceVersions.campaignVersion === command.expectedCampaignVersion;
  }
  async function view(id: string) {
    const snapshot = await repository.load(id); const now = dependencies.now();
    let eligibility: { eligible: boolean; code: string | null } = { eligible: false, code: "INVALID_CAMPAIGN_STATE" };
    if (snapshot.campaign.status === "draft" && snapshot.blueprint) {
      try { await inspect(snapshot, { campaignId: id, blueprintId: snapshot.blueprint.id, expectedBlueprintVersion: snapshot.blueprint.version,
        expectedCampaignVersion: snapshot.campaign.version, expectedContextHash: snapshot.blueprint.context_hash, confirm: true }); eligibility = { eligible: true, code: null }; }
      catch (error) { eligibility.code = error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : "CONTEXT_UNAVAILABLE"; }
    }
    if (snapshot.blueprint?.approval_status === "approved") assertMaterializedPlan(snapshot);
    return { ...snapshot, calendar: executionCalendar(snapshot.tasks, now), eligibility,
      c3: projectPublishedOffer(scope(snapshot), snapshot.campaign.published_at ? snapshot : null, now), calculatedAt: now, synthetic: true as const };
  }
  return { view,
    async publish(input: unknown) {
      const command = PublishCampaignCommandSchema.parse(input); const snapshot = await repository.load(command.campaignId);
      if (publishReplay(snapshot, command)) return { ...await view(command.campaignId), replayed: true };
      try { await inspect(snapshot, command); await repository.publish(snapshot); }
      catch (error) {
        const latest = await repository.load(command.campaignId);
        if (publishReplay(latest, command)) return { ...await view(command.campaignId), replayed: true };
        if (error instanceof CampaignExecutionError || error instanceof BlueprintError || error instanceof z.ZodError) throw error;
        return dependencies.databaseError(error);
      }
      return { ...await view(command.campaignId), replayed: false };
    },
    async close(input: unknown) {
      const command = CloseCampaignCommandSchema.parse(input); const snapshot = await repository.load(command.campaignId); const c = snapshot.campaign;
      const replay = (s: ExecutionSnapshot) => s.campaign.status === "closed" && s.campaign.closed_at !== null && s.campaign.version === command.expectedCampaignVersion + 1;
      if (replay(snapshot)) return { ...await view(c.id), replayed: true };
      if (c.status !== "published") throw new CampaignExecutionError("INVALID_CAMPAIGN_STATE");
      if (c.version !== command.expectedCampaignVersion) throw new CampaignExecutionError("VERSION_CONFLICT");
      try { await repository.close(c.id, c.version); }
      catch (error) { if (replay(await repository.load(c.id))) return { ...await view(c.id), replayed: true }; return dependencies.databaseError(error); }
      return { ...await view(c.id), replayed: false };
    },
    async task(input: unknown) {
      const command = TaskCommandSchema.parse(input); const snapshot = await repository.load(command.campaignId); const c = snapshot.campaign;
      if (!["published", "closed"].includes(c.status) || !c.published_at || c.published_blueprint_id !== command.blueprintId) throw new CampaignExecutionError("INVALID_CAMPAIGN_STATE");
      assertMaterializedPlan(snapshot);
      const task = snapshot.tasks.find((entry) => entry.id === command.taskId); if (!task) throw new CampaignExecutionError("NOT_FOUND", 404);
      if (taskUpdateDisposition(task, command.expectedTaskVersion, command.completed) === "replayed") return { ...await view(c.id), replayed: true };
      try {
        const changed = await repository.updateTask(snapshot, task.id, command.expectedTaskVersion, command.completed ? dependencies.now() : null);
        if (changed.length) return { ...await view(c.id), replayed: false };
      } catch (error) {
        const latest = (await repository.load(c.id)).tasks.find((entry) => entry.id === task.id);
        if (latest && taskUpdateDisposition(latest, command.expectedTaskVersion, command.completed) === "replayed") return { ...await view(c.id), replayed: true };
        return dependencies.databaseError(error);
      }
      const latest = (await repository.load(c.id)).tasks.find((entry) => entry.id === task.id);
      if (latest && taskUpdateDisposition(latest, command.expectedTaskVersion, command.completed) === "replayed") return { ...await view(c.id), replayed: true };
      throw new CampaignExecutionError("VERSION_CONFLICT");
    },
  };
}
