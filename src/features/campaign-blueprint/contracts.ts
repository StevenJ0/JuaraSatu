import { z } from "zod";
import { StrategyAlternativeSchema, StrategyProposalSchema, StrategyChannelSchema } from "../campaign-strategist/contracts";
import { SimulationResultSchema } from "../campaign-simulator";

const HashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const KeySchema = z.string().regex(/^[a-z0-9-]{1,64}$/);
const planText = (maxLength: number) => z.string().min(1).max(maxLength).refine(text => text.trim().length > 0, "Text must not be blank");
const TextSchema = planText(500);
export const SelectionSchema = z.strictObject({ sessionId: z.uuid(), generationId: z.uuid(), proposalVersion: z.number().int().min(2), proposalKey: KeySchema });
export type Selection = z.infer<typeof SelectionSchema>;
export const SourceSchema = SelectionSchema.extend({ messageId: z.uuid(), proposalHash: HashSchema });
export const PersistedSelectionSchema = z.object({ source: SourceSchema, proposal: StrategyProposalSchema,
  alternative: StrategyAlternativeSchema.safeExtend({ computedScenario: SimulationResultSchema }) });
export type PersistedSelection = z.infer<typeof PersistedSelectionSchema>;
export const SourceVersionsSchema = z.strictObject({ preorderVersion: z.number().int().positive(), preorderItemVersion: z.number().int().positive(),
  productVersion: z.number().int().positive(), capacityVersion: z.number().int().positive() });
export const BlueprintTaskSchema = z.strictObject({ key: KeySchema, title: planText(160), description: TextSchema,
  channel: StrategyChannelSchema, dueAt: z.iso.datetime() });
export const BlueprintContentSchema = z.strictObject({ key: KeySchema, channel: StrategyChannelSchema,
  type: z.enum(["headline", "caption", "cta"]), body: planText(2200) });
export const BlueprintPlanSchema = z.strictObject({ goal: TextSchema, hypothesis: TextSchema, audienceHypothesis: TextSchema,
  rationale: TextSchema, tasks: z.array(BlueprintTaskSchema).min(1).max(12), contents: z.array(BlueprintContentSchema).min(1).max(8),
  risks: z.array(TextSchema).min(1).max(8), dependencies: z.array(TextSchema).min(1).max(8), ownerChecklist: z.array(TextSchema).min(1).max(8),
}).superRefine((plan, ctx) => {
  for (const key of ["tasks", "contents"] as const) {
    if (new Set(plan[key].map((entry) => entry.key)).size !== plan[key].length) ctx.addIssue({ code: "custom", path: [key], message: "Duplicate identifiers" });
  }
});
export type BlueprintPlan = z.infer<typeof BlueprintPlanSchema>;
export const BlueprintEditsSchema = z.strictObject({ title: z.string().trim().min(1).max(160),
  marketingApproach: StrategyAlternativeSchema.shape.marketingApproach,
  discountBps: z.number().int().min(0).max(9999), budgetCapIdr: z.number().int().min(0).max(1_000_000_000),
  targetAdditionalUnits: z.number().int().min(1).max(10000), startsAt: z.iso.datetime(), endsAt: z.iso.datetime(),
  channels: z.array(StrategyChannelSchema).min(1).max(2).refine((channels) => new Set(channels).size === channels.length),
  notes: z.string().trim().max(500), plan: BlueprintPlanSchema.optional(),
});
export type BlueprintEdits = z.infer<typeof BlueprintEditsSchema>;
export const BlueprintScenarioSchema = z.enum(["valid", "failure", "invalid"]);
export const CampaignBlueprintSchema = BlueprintPlanSchema.safeExtend({
  schemaVersion: z.literal(1), businessId: z.uuid(), campaignId: z.uuid(), preorderId: z.uuid(), blueprintVersion: z.number().int().positive(),
  proposalVersion: z.number().int().min(2), source: SourceSchema, contextHash: HashSchema, sourceVersions: SourceVersionsSchema,
  campaignTitle: z.string().trim().min(1).max(160), marketingApproach: StrategyAlternativeSchema.shape.marketingApproach,
  offer: z.strictObject({ type: z.enum(["normal_price", "percent_discount"]), discountBps: z.number().int().min(0).max(9999) }),
  executionWindow: z.strictObject({ startsAt: z.iso.datetime(), endsAt: z.iso.datetime() }),
  budgetCapIdr: z.number().int().min(0).max(1_000_000_000), targetAdditionalUnits: z.number().int().min(1).max(10000),
  channels: z.array(StrategyChannelSchema).min(1).max(2), primaryKpi: z.literal("paid_units_in_window"),
  financial: z.object({ frozenBasePriceIdr: z.number().int().positive(), variableCostIdr: z.number().int().nonnegative().nullable(),
    costQuality: z.enum(["unknown", "estimated", "verified"]), calculation: SimulationResultSchema }),
  kpiPlan: z.strictObject({ target: z.number().int().positive(), definition: TextSchema, baselineNote: TextSchema, actualMetrics: z.null() }),
  evaluationPlan: TextSchema, assumptions: z.array(TextSchema).min(1).max(8),
  revision: z.strictObject({ requestId: z.uuid(), requestHash: HashSchema, expectedCampaignVersion: z.number().int().positive(),
    parentBlueprintId: z.uuid().nullable(), parentVersion: z.number().int().positive().nullable(), notes: z.string().max(500) }),
  provider: z.enum(["development-fake-blueprint", "gemini", "manual"]), synthetic: z.boolean(),
  model: z.string().regex(/^gemini-[a-zA-Z0-9.-]{1,100}$/).optional(), providerRequestId: z.string().min(1).max(256).nullable().optional(),
}).refine(body => body.provider === "gemini" ? body.model !== undefined && body.providerRequestId !== undefined
  : body.model === undefined && body.providerRequestId === undefined && (body.provider !== "manual" ||
    body.revision.parentBlueprintId !== null && body.revision.parentVersion !== null), "Provider metadata must match its source");
export type CampaignBlueprint = z.infer<typeof CampaignBlueprintSchema>;
export const CampaignRowSchema = z.object({ id: z.uuid(), business_id: z.uuid(), preorder_id: z.uuid(), name: z.string(),
  status: z.enum(["draft", "published", "closed", "completed", "cancelled"]), version: z.number().int().positive(), active_blueprint_id: z.uuid().nullable(),
  published_at: z.string().nullable(), offer_type: z.string(), discount_bps: z.number().int(), budget_cap_idr: z.number().int(), target_additional_units: z.number().int(),
  starts_at: z.string(), ends_at: z.string() });
export type CampaignRow = z.infer<typeof CampaignRowSchema>;
export const BlueprintRowSchema = z.object({ id: z.uuid(), business_id: z.uuid(), campaign_id: z.uuid(), version: z.number().int().positive(),
  approval_status: z.enum(["proposed", "approved", "discarded"]), blueprint_json: CampaignBlueprintSchema,
  source_ai_generation_id: z.uuid(), context_hash: HashSchema, approved_by_user_id: z.uuid().nullable(), approved_at: z.string().nullable() });
export type BlueprintRow = z.infer<typeof BlueprintRowSchema>;
export type BlueprintProvider = { kind?: "gemini"; model?: string; generate(input: { alternative: PersistedSelection["alternative"]; edits: BlueprintEdits; now: string }): Promise<unknown> };
export const GeminiBlueprintResultSchema = z.strictObject({ plan: BlueprintPlanSchema, model: z.string().min(1).max(128), providerRequestId: z.string().min(1).max(256).nullable() });
export class BlueprintError extends Error { constructor(readonly code: string, readonly status = 409) { super(code); } }
