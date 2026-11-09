import type { GeminiDebugStage } from "@/lib/ai/gemini-debug.server";
import { createHash } from "node:crypto";
import { DiscussionInputSchema, type StrategyDependencies, type StrategyErrorCode, type StrategyProposal, type StrategyResult } from "./contracts";
import type { DiscussionRepository, DiscussionScope, RepositoryError } from "./discussion-repository";
import { SendDiscussionSchema } from "./persistence-contracts";
import { generateCampaignStrategies } from "./strategy-service";

export type DiscussionOutcome = { success: true; status: "completed"; proposal: StrategyProposal; replayed: boolean; persisted: true }
  | { success: true; status: "running"; generationId: string }
  | { success: false; code: RepositoryError | StrategyErrorCode };
export function discussionInputHash(command: unknown) {
  const parsed = SendDiscussionSchema.parse(command);
  return createHash("sha256").update(JSON.stringify({ sessionId: parsed.sessionId, contextHash: parsed.expectedContextHash,
    message: parsed.message, preferences: parsed.preferences, scenario: parsed.scenario })).digest("hex");
}
export async function sendPersistentDiscussion(scope: DiscussionScope, input: unknown, repository: DiscussionRepository,
  dependencies: StrategyDependencies): Promise<DiscussionOutcome> {
  const debug = dependencies.debug;
  let stage: GeminiDebugStage = "INPUT_VALIDATION";
  try {
    const parsed = SendDiscussionSchema.safeParse(input);
    if (!parsed.success || parsed.data.sessionId !== scope.sessionId) { if (!parsed.success) debug?.issues(stage, parsed.error, input); debug?.event(stage, "FAILED", { code: "INVALID_INPUT" }); return { success: false, code: "INVALID_INPUT" }; }
    const command = parsed.data;
    stage = "PERSISTENCE";
    debug?.event(stage, "STARTED");
    const loaded = await repository.load(scope);
    if (!loaded.success) { debug?.event(stage, "FAILED", { code: loaded.code }); return loaded; }
    let history = loaded.data.messages.slice(-20);
    while (history.length && history.reduce((size, message) => size + message.content.length, command.message.length) > 12000) history = history.slice(1);
    const engineInputValue = { businessId: scope.businessId, preorderId: scope.preorderId,
      sessionId: scope.sessionId, requestKey: command.requestKey, expectedVersion: command.expectedVersion,
      expectedContextHash: command.expectedContextHash, message: command.message, preferences: command.preferences, history,
      ...(loaded.data.previousProposals ? { previousProposals: loaded.data.previousProposals } : {}) };
    const engineInput = DiscussionInputSchema.safeParse(engineInputValue);
    if (!engineInput.success) { debug?.issues("INPUT_VALIDATION", engineInput.error, engineInputValue); return { success: false, code: "INVALID_INPUT" }; }
    stage = "IDEMPOTENCY";
    const claim = await repository.beginTurn({ scope, expectedVersion: command.expectedVersion, contextHash: command.expectedContextHash,
      requestKey: command.requestKey, inputHash: discussionInputHash(command), message: command.message });
    if (!claim.success) { debug?.event(stage, "FAILED", { code: claim.code }); return claim; }
    debug?.event(stage, "SUCCESS", { claimStatus: claim.data.status });
    if (claim.data.status !== "claimed") debug?.event("SDK_REQUEST", "SKIPPED", { claimStatus: claim.data.status, replayed: true });
    if (claim.data.status === "completed") return { success: true, status: "completed", proposal: claim.data.proposal, replayed: true, persisted: true };
    if (claim.data.status === "running") return { success: true, status: "running", generationId: claim.data.generationId };
    if (claim.data.status === "failed") { debug?.event("IDEMPOTENCY", "FAILED", { claimStatus: "failed", code: claim.data.errorCode, replayed: true }); return { success: false, code: claim.data.errorCode }; }
    const turn = claim.data;
    stage = "SDK_REQUEST";
    let generated: StrategyResult;
    try { generated = await generateCampaignStrategies(engineInput.data, dependencies); }
    catch (error) { debug?.event(stage, "FAILED", { code: "PROVIDER_UNAVAILABLE", error }); generated = { success: false, error: { code: "PROVIDER_UNAVAILABLE", message: "Provider unavailable" } } as const; }
    if (!generated.success) {
      stage = "PERSISTENCE";
      const failed = await repository.failTurn({ scope, generationId: turn.generationId, claimVersion: turn.claimVersion, errorCode: generated.error.code });
      debug?.event(stage, failed.success ? "SUCCESS" : "FAILED", { code: failed.success ? generated.error.code : "PERSISTENCE_UNAVAILABLE", persisted: false });
      return { success: false, code: failed.success ? generated.error.code : "PERSISTENCE_UNAVAILABLE" };
    }
    const proposal: StrategyProposal = { ...generated.data, persistence: "saved", limitations: generated.data.limitations
      .filter((line) => !line.startsWith("Proposal belum disimpan,"))
      .concat("Snapshot diskusi tersimpan; pemilihan, approval, dan publikasi belum dilakukan.") };
    stage = "PERSISTENCE";
    debug?.event(stage, "STARTED");
    const saved = await repository.completeTurn({ scope, generationId: turn.generationId, claimVersion: turn.claimVersion, proposal });
    if (!saved.success) {
      debug?.event(stage, "FAILED", { code: saved.code, persisted: false });
      await repository.failTurn({ scope, generationId: turn.generationId, claimVersion: turn.claimVersion, errorCode: "PROVIDER_UNAVAILABLE" });
      return { success: false, code: "PERSISTENCE_UNAVAILABLE" };
    }
    debug?.event(stage, "SUCCESS", { persisted: true });
    return { success: true, status: "completed", proposal, replayed: false, persisted: true };
  } catch (error) { debug?.event(stage, "FAILED", { error }); throw error; }
}
