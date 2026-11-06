import { z } from "zod";
import { calculateUnitPrice } from "../pricing";
import { supabaseUtcTimestamp } from "@/lib/supabase/timestamps";
import { CampaignExecutionError, ExecutionSnapshotSchema, PublicationBaselineSchema, PublishedOfferSchema, type ExecutionSnapshot, type ExecutionTask, type PublishedOffer } from "./contracts";

const ScopeSchema = z.object({ businessId: z.uuid(), preorderId: z.uuid() });
const PublishedSnapshotSchema = ExecutionSnapshotSchema.omit({ tasks: true, contents: true });
export function projectPublishedOffer(scopeInput: z.infer<typeof ScopeSchema>, input: unknown, nowInput: string): PublishedOffer {
  const scope = ScopeSchema.parse(scopeInput); const now = z.iso.datetime({ offset: true }).parse(nowInput);
  const empty = { schemaVersion: 1 as const, ...scope, calculatedAt: now, eligible: false, configuration: null };
  if (input === null) return { ...empty, state: "none", reason: null };
  const parsed = PublishedSnapshotSchema.safeParse(input);
  if (!parsed.success) return { ...empty, state: "invalid", reason: "INVALID_PUBLISHED_CONFIGURATION" };
  const { campaign: c, blueprint: bp, preorder: po, item } = parsed.data;
  const b = bp?.blueprint_json;
  const baseline = PublicationBaselineSchema.safeParse(c.baseline_json);
  if (!bp || !b || c.business_id !== scope.businessId || c.preorder_id !== scope.preorderId || po.id !== scope.preorderId || po.business_id !== scope.businessId ||
    item.business_id !== scope.businessId || item.preorder_id !== po.id || bp.business_id !== c.business_id || bp.campaign_id !== c.id ||
    c.active_blueprint_id !== bp.id || c.published_blueprint_id !== bp.id || bp.approval_status !== "approved" || !bp.approved_at || !bp.approved_by_user_id ||
    b.businessId !== c.business_id || b.campaignId !== c.id || b.preorderId !== po.id || b.blueprintVersion !== bp.version || b.contextHash !== bp.context_hash ||
    !c.published_at || !c.baseline_calculated_at || c.metrics_schema_version !== 1 || !baseline.success ||
    baseline.data.sourceVersions.businessId !== c.business_id || baseline.data.sourceVersions.preorderId !== c.preorder_id ||
    baseline.data.sourceVersions.itemId !== item.id || baseline.data.sourceVersions.basePriceIdr !== item.base_price_snapshot_idr ||
    bp.source_ai_generation_id !== b.source.generationId || b.proposalVersion !== b.source.proposalVersion ||
    !["published", "closed", "completed"].includes(c.status) || c.offer_type !== b.offer.type || c.discount_bps !== b.offer.discountBps ||
    supabaseUtcTimestamp(c.starts_at) !== supabaseUtcTimestamp(b.executionWindow.startsAt) || supabaseUtcTimestamp(c.ends_at) !== supabaseUtcTimestamp(b.executionWindow.endsAt) ||
    item.base_price_snapshot_idr !== b.financial.frozenBasePriceIdr || item.id !== b.financial.calculation.preorderItemId ||
    Date.parse(c.starts_at) >= Date.parse(c.ends_at) || Date.parse(c.starts_at) < Date.parse(po.starts_at) || Date.parse(c.ends_at) > Date.parse(po.ends_at) ||
    ((c.status === "closed" || c.status === "completed") && !c.closed_at)) return { ...empty, state: "invalid", reason: "INVALID_PUBLISHED_CONFIGURATION" };
  for (const key of ["capacityVersion", "preorderVersion", "preorderItemVersion", "productVersion"] as const) {
    if (baseline.data.sourceVersions[key] !== b.sourceVersions[key]) return { ...empty, state: "invalid", reason: "INVALID_PUBLISHED_CONFIGURATION" };
  }
  const price = calculateUnitPrice({ baseUnitPriceIdr: item.base_price_snapshot_idr, offer: { offerType: c.offer_type, discountBps: c.discount_bps } });
  if (!price.success || price.data.finalUnitPriceIdr !== b.financial.calculation.hypotheticalFinalUnitPriceIdr) return { ...empty, state: "invalid", reason: "INVALID_PUBLISHED_CONFIGURATION" };
  const configuration = { campaignId: c.id, campaignVersion: c.version, publishedBlueprintId: bp.id, publishedBlueprintVersion: bp.version,
    preorderItemId: item.id, preorderItemVersion: item.version, frozenBaseUnitPriceIdr: item.base_price_snapshot_idr,
    offer: { offerType: b.offer.type, discountBps: c.discount_bps }, unitPriceIdr: price.data.finalUnitPriceIdr,
    startsAt: c.starts_at, endsAt: c.ends_at, publishedAt: c.published_at, closedAt: c.closed_at, status: c.status,
    contextHash: bp.context_hash, sourceGenerationId: bp.source_ai_generation_id, sourceProposalVersion: b.source.proposalVersion, sourceVersions: b.sourceVersions };
  const clock = Date.parse(now);
  const state = c.status !== "published" || c.closed_at ? "closed" : clock >= Date.parse(c.ends_at) ? "expired"
    : clock < Math.max(Date.parse(c.starts_at), Date.parse(c.published_at)) ? "scheduled" : po.status !== "published" || clock >= Date.parse(po.ends_at) ? "closed" : "active";
  return PublishedOfferSchema.parse({ ...empty, configuration, state, eligible: state === "active", reason: state === "active" ? null : state.toUpperCase() });
}

export function assertMaterializedPlan(snapshot: ExecutionSnapshot) {
  const { campaign: c, blueprint: bp, tasks, contents } = snapshot;
  if (!bp || bp.approval_status !== "approved" || !bp.approved_at || !bp.approved_by_user_id || bp.campaign_id !== c.id || bp.business_id !== c.business_id ||
    (c.published_at ? c.published_blueprint_id : c.active_blueprint_id) !== bp.id || bp.blueprint_json.blueprintVersion !== bp.version ||
    bp.blueprint_json.campaignId !== c.id || bp.blueprint_json.preorderId !== c.preorder_id || bp.blueprint_json.businessId !== c.business_id || bp.context_hash !== bp.blueprint_json.contextHash ||
    tasks.length !== bp.blueprint_json.tasks.length || contents.length !== bp.blueprint_json.contents.length) throw new CampaignExecutionError("INVALID_EXECUTION_PLAN");
  for (const task of tasks) {
    const planned = bp.blueprint_json.tasks.find((entry) => entry.key === task.task_key);
    if (!planned || task.business_id !== c.business_id || task.campaign_id !== c.id || task.blueprint_id !== bp.id || task.title !== planned.title ||
      task.description !== planned.description || task.channel !== planned.channel || supabaseUtcTimestamp(task.due_at) !== supabaseUtcTimestamp(planned.dueAt)) throw new CampaignExecutionError("INVALID_EXECUTION_PLAN");
  }
  for (const content of contents) {
    const planned = bp.blueprint_json.contents.find((entry) => entry.key === content.content_key);
    if (!planned || content.business_id !== c.business_id || content.campaign_id !== c.id || content.blueprint_id !== bp.id || content.channel !== planned.channel ||
      content.content_type !== planned.type || content.body !== planned.body) throw new CampaignExecutionError("INVALID_EXECUTION_PLAN");
  }
}
export function executionCalendar(tasks: readonly ExecutionTask[], now: string) {
  z.iso.datetime({ offset: true }).parse(now);
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit" });
  const grouped = new Map<string, (ExecutionTask & { executionStatus: "completed" | "overdue" | "upcoming" })[]>();
  for (const task of [...tasks].sort((a, b) => Date.parse(a.due_at) - Date.parse(b.due_at) || a.task_key.localeCompare(b.task_key))) {
    const day = date.format(new Date(task.due_at)); const entries = grouped.get(day) ?? [];
    entries.push({ ...task, executionStatus: task.completed_at ? "completed" : Date.parse(task.due_at) < Date.parse(now) ? "overdue" : "upcoming" }); grouped.set(day, entries);
  }
  const complete = tasks.filter((task) => task.completed_at !== null).length;
  return { timezone: "Asia/Jakarta" as const, days: [...grouped].map(([date, tasks]) => ({ date, tasks })),
    progress: { total: tasks.length, completed: complete, remaining: tasks.length - complete,
      percent: tasks.length ? Math.round(complete * 100 / tasks.length) : 0, overdue: tasks.filter((task) => !task.completed_at && Date.parse(task.due_at) < Date.parse(now)).length } };
}
export function taskUpdateDisposition(task: ExecutionTask, expectedVersion: number, completed: boolean) {
  const matches = (task.completed_at !== null) === completed;
  if (matches && (task.version === expectedVersion || task.version === expectedVersion + 1)) return "replayed";
  if (task.version !== expectedVersion) throw new CampaignExecutionError("VERSION_CONFLICT");
  return "write";
}
