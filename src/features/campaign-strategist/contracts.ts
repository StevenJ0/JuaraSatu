import type { GeminiDebugTrace } from "@/lib/ai/gemini-debug.server";
import { z } from "zod";
import { UnitPricingInputSchema, OrderPricingResultSchema } from "../pricing";
import { SimulationResultSchema } from "../campaign-simulator";

const HashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const VersionSchema = z.number().int().min(1).max(2_147_483_646);
const ShortTextSchema = z.string().trim().min(1).max(500);
const TextSchema = z.string().trim().min(1).max(2_000);
/** Channels with copyable captions and tracked tasks (the database CHECK allows only these for contents). */
export const StrategyChannelSchema = z.enum(["whatsapp", "instagram"]);
/** Wider set of places a tactic can run; strategy-level only, never stored as a caption channel. */
export const PromotionPlatformSchema = z.enum(["whatsapp", "instagram", "tiktok", "x", "facebook", "community", "offline_store", "past_buyers"]);
export const StrategyLeverSchema = z.enum(["reach", "trust", "urgency", "price"]);
/** One-time owner answers that ground the strategy; free text is untrusted and redacted before reaching the model. */
export const OwnerIntakeSchema = z.strictObject({
  assets: z.array(PromotionPlatformSchema).max(8).refine((assets) => new Set(assets).size === assets.length),
  assetNotes: z.string().trim().max(300), targetBuyer: z.string().trim().max(200), productStrength: z.string().trim().max(200),
  suspectedCause: z.enum(["unaware", "hesitant", "price", "unknown"]).nullable(),
  dailyTime: z.enum(["under_30m", "30_60m", "over_1h"]).nullable(),
});
/** What this discussion already proposed, so a one-at-a-time answer does not repeat itself. */
export const PreviousProposalSchema = z.strictObject({ title: z.string().trim().min(1).max(120), lever: StrategyLeverSchema.nullable(),
  marketingApproach: z.enum(["scheduled_reminder", "value_content", "limited_discount"]), discountBps: z.number().int().min(0).max(9999),
  platforms: z.array(PromotionPlatformSchema).max(8) });
const TacticSchema = z.strictObject({ platform: PromotionPlatformSchema, action: z.string().trim().min(1).max(240) });
const HashtagSchema = z.string().regex(/^#[A-Za-z0-9_]{2,40}$/);
export const StrategySourceSchema = z.union([z.enum(["c1.business", "c1.product", "c1.preorder", "c6.preorder_metrics", "c8.effective_offer"]),z.string().regex(/^memory:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)]);
const SourcesSchema = z.array(StrategySourceSchema).min(1).max(10);
export const DiscussionMessageSchema = z.strictObject({
  sequence: z.number().int().min(1), role: z.enum(["user", "assistant"]),
  content: z.string().trim().min(1).max(4_000), contextHash: HashSchema,
});
export const DiscussionInputSchema = z.strictObject({
  businessId: z.uuid(), preorderId: z.uuid(), sessionId: z.uuid().nullable(),
  requestKey: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/), expectedVersion: VersionSchema,
  expectedContextHash: HashSchema, message: z.string().trim().min(1).max(4_000),
  history: z.array(DiscussionMessageSchema).max(20),
  preferences: z.strictObject({
    budgetCapIdr: OrderPricingResultSchema.shape.subtotalIdr.nullable(),
    allowDiscount: z.boolean(), channels: z.array(StrategyChannelSchema).min(1).max(2),
    intake: OwnerIntakeSchema.optional(),
  }),
  previousProposals: z.array(PreviousProposalSchema).max(12).optional(),
}).refine((input) => input.history.every((message, index, messages) =>
  index === 0 || message.sequence === messages[index - 1].sequence + 1),
{ path: ["history"], message: "History harus berurutan dan dimuat dari server." })
  .refine((input) => input.message.length + input.history.reduce((size, message) => size + message.content.length, 0) <= 12_000,
    { path: ["history"], message: "History terlalu panjang; muat window diskusi yang sesuai batas." });

export const StrategyAlternativeSchema = z.strictObject({
  proposalKey: z.string().regex(/^[a-z0-9-]{1,64}$/), title: z.string().trim().min(1).max(120),
  marketingApproach: z.enum(["scheduled_reminder", "value_content", "limited_discount"]),
  offer: UnitPricingInputSchema.shape.offer,
  assumedAdditionalUnits: z.number().int().min(1).max(10_000),
  assumedPromotionCostIdr: OrderPricingResultSchema.shape.subtotalIdr,
  channels: z.array(StrategyChannelSchema).min(1).max(2),
  startsAt: z.iso.datetime(), endsAt: z.iso.datetime(),
  hypothesis: ShortTextSchema, assumptions: z.array(ShortTextSchema).min(1).max(3),
  risks: z.array(ShortTextSchema).min(1).max(3), sourceReferences: SourcesSchema,
  // Optional so proposals stored before these fields existed still parse; Gemini must return them (GeminiReplySchema).
  lever: StrategyLeverSchema.optional(), targetAudience: z.string().trim().min(1).max(200).optional(),
  tactics: z.array(TacticSchema).min(1).max(4).optional(), hashtags: z.array(HashtagSchema).max(6).optional(),
});
export const GeminiReplySchema = z.strictObject({
  schemaVersion: z.literal(1), contextHash: HashSchema, reply: TextSchema,
  sourceReferences: SourcesSchema,
  // One alternative per answer: the owner asks for another one when this does not fit (stored proposals may hold up to three).
  options: z.array(StrategyAlternativeSchema.required({ lever: true, targetAudience: true, tactics: true, hashtags: true })).max(1),
  limitations: z.array(ShortTextSchema).min(1).max(5),
});
// Validate the envelope first so one invalid alternative cannot contaminate valid ones.
export const GeminiReplyEnvelopeSchema = GeminiReplySchema.extend({ options: z.array(z.unknown()).max(3) });
export const StrategyProposalSchema = z.strictObject({
  schemaVersion: z.literal(1), state: z.literal("proposed"), persistence: z.enum(["not_saved", "saved"]),
  status: z.enum(["alternatives_available", "no_valid_options"]),
  requiresOwnerReview: z.literal(true), businessId: z.uuid(), preorderId: z.uuid(), sessionId: z.uuid().nullable(),
  requestKey: DiscussionInputSchema.shape.requestKey, contextHash: HashSchema,
  preferences: DiscussionInputSchema.shape.preferences,
  proposalVersion: z.number().int().min(2).max(2_147_483_647), generatedAt: z.iso.datetime(),
  model: z.string().min(1).max(128), providerRequestId: z.string().min(1).max(256).nullable(),
  reply: TextSchema, sourceReferences: SourcesSchema,
  options: z.array(StrategyAlternativeSchema.safeExtend({ computedScenario: SimulationResultSchema })).max(3),
  rejectedOptions: z.array(z.strictObject({ index: z.number().int().min(0).max(2),
    code: z.enum(["INVALID_OPTION", "SOURCE_MISMATCH", "INVALID_DATES", "PREFERENCE_CONFLICT", "FINANCIAL_OR_CAPACITY_BLOCKER", "UNSAFE_TEXT"]),
    message: ShortTextSchema })).max(3),
  limitations: z.array(ShortTextSchema).min(1).max(12),
}).refine((proposal) => (proposal.status === "alternatives_available") === (proposal.options.length > 0), {
  path: ["status"], message: "Status proposal harus sesuai jumlah alternatif tervalidasi.",
});
export type DiscussionInput = z.infer<typeof DiscussionInputSchema>;
export type DiscussionMessage = z.infer<typeof DiscussionMessageSchema>;
export type StrategyAlternative = z.infer<typeof StrategyAlternativeSchema>;
export type OwnerIntake = z.infer<typeof OwnerIntakeSchema>;
export type PreviousProposal = z.infer<typeof PreviousProposalSchema>;
/** Latest twelve alternatives of a session as short summaries; platforms come from tactics, else caption channels. */
export function summarizeProposals(proposals: StrategyProposal[]): PreviousProposal[] {
  return proposals.flatMap((proposal) => proposal.options.map((option) => ({ title: option.title, lever: option.lever ?? null,
    marketingApproach: option.marketingApproach, discountBps: option.offer.discountBps,
    platforms: [...new Set(option.tactics?.map((tactic) => tactic.platform) ?? option.channels)] }))).slice(-12);
}
export type PromotionPlatform = z.infer<typeof PromotionPlatformSchema>;
export type GeminiReply = z.infer<typeof GeminiReplySchema>;
export type StrategyProposal = z.infer<typeof StrategyProposalSchema>;
export type StrategyPrompt = { systemInstruction: string; input: string };
export type ProviderFailureCode = "CONFIGURATION_ERROR" | "PROVIDER_REFUSED" | "PROVIDER_TIMEOUT"
  | "PROVIDER_RATE_LIMITED" | "MODEL_UNAVAILABLE" | "PROVIDER_UNAVAILABLE" | "INVALID_RESPONSE" | "OUTPUT_TRUNCATED";
export type StrategyProviderResult = { success: true; text: string; model: string; requestId: string | null }
  | { success: false; code: ProviderFailureCode };
export interface StrategyProvider {
  generate(prompt: StrategyPrompt): Promise<StrategyProviderResult>;
}
export type StrategyErrorCode = ProviderFailureCode | "INVALID_INPUT" | "CONTEXT_UNAVAILABLE" | "STALE_CONTEXT" | "UNSAFE_TEXT" | "NO_FEASIBLE_OPTIONS";
export type StrategyResult = { success: true; data: StrategyProposal }
  | { success: false; error: { code: StrategyErrorCode; message: string } };
export interface StrategyDependencies {
  debug?: GeminiDebugTrace;
  provider: StrategyProvider;
  /** Server-authorized C1/C6/C8 projections in BuildBusinessContextInput shape; never browser facts. */
  loadContext(scope: { businessId: string; preorderId: string }): Promise<unknown>;
  now(): string;
}
