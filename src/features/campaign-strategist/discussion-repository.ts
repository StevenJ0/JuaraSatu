import type { DiscussionMessage, StrategyProposal, StrategyErrorCode } from "./contracts";

/** Trusted auth service supplies ownerUserId; it is never evidence of auth by itself. */
export type DiscussionScope = { ownerUserId: string; businessId: string; preorderId: string; sessionId: string };
export type DiscussionSession = {
  id: string; businessId: string; preorderId: string; version: number;
  contextHash: string; status: "active" | "closed"; messages: DiscussionMessage[];
};
export type RepositoryError = "FORBIDDEN" | "NOT_FOUND" | "VERSION_CONFLICT" | "STALE_CONTEXT"
  | "IDEMPOTENCY_CONFLICT" | "TURN_IN_PROGRESS" | "PERSISTENCE_UNAVAILABLE";
export type RepositoryResult<T> = { success: true; data: T } | { success: false; code: RepositoryError };
export type TurnClaim =
  | { status: "claimed"; generationId: string; claimVersion: number }
  | { status: "running"; generationId: string }
  | { status: "completed"; generationId: string; proposal: StrategyProposal }
  | { status: "failed"; generationId: string; errorCode: StrategyErrorCode };

/** Contract only: no production implementation until approved atomic DB capabilities/auth exist. */
export interface DiscussionRepository {
  load(scope: DiscussionScope): Promise<RepositoryResult<DiscussionSession>>;
  /** Atomic: compare version/context, claim dedupe key+server inputHash, append user message, advance version. */
  beginTurn(command: { scope: DiscussionScope; expectedVersion: number; contextHash: string;
    requestKey: string; inputHash: string; message: string }): Promise<RepositoryResult<TurnClaim>>;
  /** Atomic: CAS, generation success, assistant message+proposal, advance version; same completion replays. */
  completeTurn(command: { scope: DiscussionScope; generationId: string; claimVersion: number;
    proposal: StrategyProposal }): Promise<RepositoryResult<DiscussionSession>>;
  /** Atomic: record sanitized failure, release the claim, advance version; never append fake assistant success. */
  failTurn(command: { scope: DiscussionScope; generationId: string; claimVersion: number;
    errorCode: StrategyErrorCode }): Promise<RepositoryResult<DiscussionSession>>;
}
