import { z } from "zod";
import { EvaluationSummarySchema } from "../campaign-evaluation/contracts";
const Id = z.uuid(); const Time = z.iso.datetime({ offset: true });
export const Hash = z.string().regex(/^[a-f0-9]{64}$/);
const Version = z.number().int().positive().max(2_147_483_647);
const Text = z.string().trim().min(1).max(600);
export const MemorySourceSchema = z.object({ businessId: Id, campaignId: Id, preorderId: Id, evaluationId: Id, blueprintId: Id, sourceVersion: Version,
  contextHash: Hash, sourceFactsAt: Time, synthetic: z.boolean(), productionEligible: z.boolean(), developmentEligible: z.boolean(),
  objective: Text, strategy: z.object({ marketingApproach: Text, offerType: z.enum(["normal_price", "percent_discount"]), discountBps: z.number().int().min(0).max(9999),
    startsAt: Time, endsAt: Time }), results: EvaluationSummarySchema,
  sourceVersions: z.object({ campaignVersion: Version, preorderVersion: Version, preorderItemVersion: Version, blueprintVersion: Version.nullable(),
    tasks: z.array(z.object({ id: Id, version: Version })).max(12), costs: z.array(z.object({ id: Id, version: Version })).max(100),
    analytics: z.object({ sourceId: z.string().max(128), sourceVersion: Version }).nullable() }),
  limitations: z.array(Text).min(1).max(20) }).refine((s) => (!s.synthetic || !s.productionEligible) && s.synthetic===s.results.synthetic, "Synthetic evidence cannot be production eligible or relabelled");
export type MemorySource = z.infer<typeof MemorySourceSchema>;
export const MemoryInterpretationSchema = z.strictObject({ businessId: Id, campaignId: Id, sourceEvaluationId: Id, sourceVersion: Version,
  outcome: z.enum(["above_target", "below_target", "unknown"]), financialState: z.enum(["positive", "nonpositive", "unknown"]), executionState: z.enum(["complete", "incomplete"]),
  summary: Text, lessons: z.array(Text).min(1).max(5), risks: z.array(Text).min(1).max(5), recommendations: z.array(Text).min(1).max(5),
  evidenceReferences: z.array(z.enum(["campaign", "blueprint", "execution", "costs", "c6"])).min(1).max(5) });
export type MemoryInterpretation = z.infer<typeof MemoryInterpretationSchema>;
export type MemoryProvider = ({ kind?: undefined } | { kind: "gemini"; model: string }) & { generate(source: MemorySource): Promise<unknown> };
export const MemoryReviewSchema = z.object({ decision: z.enum(["unreviewed", "reviewed", "rejected"]), ownerUserId: Id.nullable(), reviewedAt: Time.nullable(), requestId: Id.nullable(), expectedContentHash: Hash.nullable() })
  .refine((r) => r.decision === "unreviewed" ? r.ownerUserId === null && r.reviewedAt === null && r.requestId === null && r.expectedContentHash===null : r.ownerUserId !== null && r.reviewedAt !== null && r.requestId !== null && r.expectedContentHash!==null);
export const MemoryPayloadSchema = z.object({ schemaVersion: z.literal(1), provider: z.enum(["development-fake-memory", "gemini"]),
  model: z.string().regex(/^gemini-[a-zA-Z0-9.-]{1,100}$/).optional(), providerRequestId: z.string().min(1).max(256).nullable().optional(), generatedAt: Time.optional(),
  generation: z.object({ requestId: Id, scenario: z.enum(["valid", "failure", "invalid", "missing_evidence"]) }), source: MemorySourceSchema,
  interpretation: MemoryInterpretationSchema, ownerReview: MemoryReviewSchema })
  .refine(p => p.provider === "gemini" ? p.model !== undefined && p.providerRequestId !== undefined && p.generatedAt !== undefined
    : p.model === undefined && p.providerRequestId === undefined && p.generatedAt === undefined, "Provider provenance must match its source");
export const MemoryRowSchema = z.object({ id: Id, business_id: Id, campaign_id: Id, source_evaluation_id: Id, source_blueprint_id: Id.nullable(), source_version: Version,
  summary_text: z.string().min(1).max(600), lessons_json: MemoryPayloadSchema, limitations_json: z.array(Text), content_hash: Hash,
  review_status: z.enum(["draft", "approved"]), embedding_status: z.enum(["queued", "ready", "failed", "stale"]),
  embedding_model: z.string().min(1).max(128).nullable(), embedding_profile: z.string().min(1).max(128).nullable(), embedding_version: Version,
  approved_at: Time.nullable(), indexed_at: Time.nullable(), created_at: Time, updated_at: Time });
export type MemoryRow = z.infer<typeof MemoryRowSchema>;
export const GenerateMemorySchema = z.strictObject({ campaignId: Id, evaluationId: Id, requestId: Id, expectedContextHash: Hash,
  scenario: z.enum(["valid", "failure", "invalid", "missing_evidence"]).default("valid") });
export const ReviewMemorySchema = z.strictObject({ memoryId: Id, requestId: Id, expectedContentHash: Hash, decision: z.enum(["reviewed", "rejected"]), confirm: z.literal(true) });
export const ApproveMemorySchema = z.strictObject({ memoryId: Id, expectedContentHash: Hash, confirm: z.literal(true) });
export const RetrievalCommandSchema = z.strictObject({ query: z.string().trim().min(3).max(1200), limit: z.number().int().min(1).max(5).default(3) });
export const MemoryJobSchema = z.object({ id: Id, job_type: z.literal("embed_memory"), entity_id: Id, business_id: Id, dedupe_key: z.string().min(1).max(2000),
  status: z.enum(["queued", "running", "succeeded", "retryable_failed", "dead"]), attempt_count: z.number().int().nonnegative().max(20),
  locked_until: Time.nullable(), next_run_at: Time, last_error_code: z.string().nullable() });
export type MemoryJob = z.infer<typeof MemoryJobSchema>;
export const MemoryWorkerResultSchema=z.object({status:z.enum(["idle","processed"]),claimed:z.number().int().min(0).max(1),succeeded:z.number().int().min(0).max(1),failed:z.number().int().min(0).max(1),
  results:z.array(z.object({jobId:Id,status:z.enum(["succeeded","failed"]),code:z.string().nullable()})).max(1)})
  .refine(r=>r.results.length===r.claimed&&r.succeeded+r.failed===r.claimed&&(r.status==="idle")===(r.claimed===0));
export const MemoryViewSchema = z.object({ row: MemoryRowSchema, stale: z.boolean(), approval: z.object({ eligible: z.boolean(), blockers: z.array(z.string()) }),
  indexing: z.object({ code: z.string(), canRun: z.boolean(),job:MemoryJobSchema.nullable().default(null) }), synthetic: z.boolean() });
export class MemoryError extends Error { constructor(readonly code: string, readonly status = 409) { super(code); } }
