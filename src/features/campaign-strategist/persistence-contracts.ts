import { z } from "zod";
import { DiscussionInputSchema, DiscussionMessageSchema, StrategyProposalSchema } from "./contracts";

export const ScenarioSchema = z.enum(["normal", "discount", "revision", "failure", "invalid"]);
export type DevelopmentScenario = z.infer<typeof ScenarioSchema>;
export const SendDiscussionSchema = z.strictObject({
  sessionId: z.uuid(), requestKey: DiscussionInputSchema.shape.requestKey,
  expectedVersion: DiscussionInputSchema.shape.expectedVersion,
  expectedContextHash: DiscussionInputSchema.shape.expectedContextHash,
  message: DiscussionInputSchema.shape.message, preferences: DiscussionInputSchema.shape.preferences,
  scenario: ScenarioSchema.default("normal"),
});
export type SendDiscussion = z.infer<typeof SendDiscussionSchema>;
export const PersistedMessageSchema = DiscussionMessageSchema.extend({ id: z.uuid(), proposal: StrategyProposalSchema.nullable() });
export const GenerationSchema = z.object({ id: z.uuid(), status: z.enum(["running", "success", "failed", "invalid_output"]),
  started_at: z.iso.datetime({ offset: true }).nullable(), error_code: z.string().nullable(), request_key: z.string() });
export const DiscussionViewSchema = z.object({ id: z.uuid(), businessId: z.uuid(), preorderId: z.uuid(), version: z.number().int().positive(),
  contextHash: z.string().regex(/^[a-f0-9]{64}$/), status: z.enum(["active", "closed"]),
  messages: z.array(PersistedMessageSchema).max(200), generations: z.array(GenerationSchema).max(200),
  truncated: z.boolean(),
});
export type DiscussionView = z.infer<typeof DiscussionViewSchema>;
