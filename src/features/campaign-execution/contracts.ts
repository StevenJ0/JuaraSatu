import { z } from "zod";
import { CampaignRowSchema, BlueprintRowSchema, SourceVersionsSchema } from "../campaign-blueprint/contracts";

const Timestamp = z.iso.datetime({ offset: true });
const Version = z.number().int().positive().max(2_147_483_647);
export const PublicationBaselineSchema = z.object({ baseline_preorder_paid_units: z.number().int().nonnegative(),
  sourceVersions: SourceVersionsSchema.extend({ campaignVersion: Version, businessId: z.uuid(), preorderId: z.uuid(), itemId: z.uuid(),
    basePriceIdr: z.number().int().positive().max(1_000_000_000) }).strip() });
export const LifecycleCampaignSchema = CampaignRowSchema.extend({ marketing_approach: z.enum(["scheduled_reminder", "value_content", "limited_discount"]),
  starts_at: Timestamp, ends_at: Timestamp, published_at: Timestamp.nullable(),
  primary_kpi: z.literal("paid_units_in_window"), published_blueprint_id: z.uuid().nullable(), closed_at: Timestamp.nullable(),
  completed_at: Timestamp.nullable(), baseline_json: z.unknown(), baseline_calculated_at: Timestamp.nullable(), metrics_schema_version: Version.nullable() });
export type LifecycleCampaign = z.infer<typeof LifecycleCampaignSchema>;
export const ExecutionTaskSchema = z.object({ id: z.uuid(), business_id: z.uuid(), campaign_id: z.uuid(), blueprint_id: z.uuid(), task_key: z.string().min(1).max(64),
  title: z.string().min(1).max(160), description: z.string().max(500).nullable(), channel: z.enum(["whatsapp", "instagram", "offline"]).nullable(),
  due_at: Timestamp, completed_at: Timestamp.nullable(), version: Version });
export type ExecutionTask = z.infer<typeof ExecutionTaskSchema>;
export const ExecutionContentSchema = z.object({ id: z.uuid(), business_id: z.uuid(), campaign_id: z.uuid(), blueprint_id: z.uuid(), content_key: z.string().min(1).max(64),
  channel: z.enum(["whatsapp", "instagram", "offline"]), content_type: z.enum(["headline", "caption", "cta"]), body: z.string().min(1).max(2200), version: Version });
export const FrozenPreorderSchema = z.object({ id: z.uuid(), business_id: z.uuid(), status: z.enum(["draft", "published", "closed", "completed", "cancelled"]),
  starts_at: Timestamp, ends_at: Timestamp, fulfillment_date: z.iso.date(), version: Version });
export const FrozenItemSchema = z.object({ id: z.uuid(), business_id: z.uuid(), preorder_id: z.uuid(), base_price_snapshot_idr: z.number().int().positive().max(1_000_000_000), version: Version });
export const ExecutionSnapshotSchema = z.object({ campaign: LifecycleCampaignSchema, blueprint: BlueprintRowSchema.nullable(),
  preorder: FrozenPreorderSchema, item: FrozenItemSchema, tasks: z.array(ExecutionTaskSchema).max(12), contents: z.array(ExecutionContentSchema).max(8) });
export type ExecutionSnapshot = z.infer<typeof ExecutionSnapshotSchema>;
export const PublishCampaignCommandSchema = z.strictObject({ campaignId: z.uuid(), blueprintId: z.uuid(), expectedBlueprintVersion: Version,
  expectedCampaignVersion: Version, expectedContextHash: z.string().regex(/^[a-f0-9]{64}$/), confirm: z.literal(true) });
export const CloseCampaignCommandSchema = z.strictObject({ campaignId: z.uuid(), expectedCampaignVersion: Version, confirm: z.literal(true) });
export const TaskCommandSchema = z.strictObject({ campaignId: z.uuid(), blueprintId: z.uuid(), taskId: z.uuid(), expectedTaskVersion: Version, completed: z.boolean() });
export type PublishCampaignCommand = z.infer<typeof PublishCampaignCommandSchema>;
export const PublishedOfferSchema = z.object({ schemaVersion: z.literal(1), businessId: z.uuid(), preorderId: z.uuid(), calculatedAt: Timestamp,
  state: z.enum(["none", "scheduled", "active", "expired", "closed", "invalid", "unavailable"]), eligible: z.boolean(), reason: z.string().nullable(),
  configuration: z.object({ campaignId: z.uuid(), campaignVersion: Version, publishedBlueprintId: z.uuid(), publishedBlueprintVersion: Version,
    preorderItemId: z.uuid(), preorderItemVersion: Version, frozenBaseUnitPriceIdr: z.number().int().positive(),
    offer: z.object({ offerType: z.enum(["normal_price", "percent_discount"]), discountBps: z.number().int().min(0).max(9999) }), unitPriceIdr: z.number().int().positive(),
    startsAt: Timestamp, endsAt: Timestamp, publishedAt: Timestamp, closedAt: Timestamp.nullable(), status: LifecycleCampaignSchema.shape.status,
    contextHash: z.string(), sourceGenerationId: z.uuid(), sourceProposalVersion: Version,
    sourceVersions: BlueprintRowSchema.shape.blueprint_json.shape.sourceVersions }) .nullable() });
export type PublishedOffer = z.infer<typeof PublishedOfferSchema>;
export const ExecutionViewSchema = ExecutionSnapshotSchema.extend({ c3: PublishedOfferSchema,
  calendar: z.object({ timezone: z.literal("Asia/Jakarta"), days: z.array(z.object({ date: z.iso.date(),
    tasks: z.array(ExecutionTaskSchema.extend({ executionStatus: z.enum(["completed", "overdue", "upcoming"]) })) })),
    progress: z.object({ total: z.number().int().min(0).max(12), completed: z.number().int().min(0).max(12), remaining: z.number().int().min(0).max(12),
      percent: z.number().int().min(0).max(100), overdue: z.number().int().min(0).max(12) }) }),
  eligibility: z.object({ eligible: z.boolean(), code: z.string().nullable() }), calculatedAt: Timestamp, synthetic: z.boolean(), replayed: z.boolean().optional() });
export type ExecutionView = z.infer<typeof ExecutionViewSchema>;
export class CampaignExecutionError extends Error { constructor(readonly code: string, readonly status = 409) { super(code); } }
