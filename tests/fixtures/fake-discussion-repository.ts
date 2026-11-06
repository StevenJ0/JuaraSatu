import { randomUUID } from "node:crypto";
import type { DiscussionRepository, DiscussionScope, DiscussionSession, RepositoryError, RepositoryResult, TurnClaim } from "../../src/features/campaign-strategist/discussion-repository";
import type { StrategyProposal, StrategyErrorCode } from "../../src/features/campaign-strategist/contracts";

type Turn = { generationId: string; requestKey: string; inputHash: string; contextHash: string;
  claimVersion: number; status: "running" | "completed" | "failed";
  proposal: StrategyProposal | null; errorCode: StrategyErrorCode | null };
const fail = <T>(code: RepositoryError): RepositoryResult<T> => ({ success: false, code });

// Test fixture only: Maps are not production persistence, distributed locks, or authorization.
export function fakeDiscussionRepository(seed: { ownerUserId: string; session: DiscussionSession }, failFinalize = false): DiscussionRepository {
  const session = structuredClone(seed.session);
  const turns = new Map<string, Turn>();
  let pending: string | null = null;
  function access(scope: DiscussionScope): RepositoryError | null {
    if (scope.ownerUserId !== seed.ownerUserId || scope.businessId !== session.businessId || scope.preorderId !== session.preorderId) return "FORBIDDEN";
    return scope.sessionId === session.id ? null : "NOT_FOUND";
  }
  function current(): RepositoryResult<DiscussionSession> { return { success: true, data: structuredClone(session) }; }
  function find(generationId: string) { return [...turns.values()].find((turn) => turn.generationId === generationId); }
  return {
    async load(scope) { const error = access(scope); return error ? fail(error) : current(); },
    async beginTurn(command) {
      const error = access(command.scope);
      if (error) return fail(error);
      const existing = turns.get(command.requestKey);
      if (existing) {
        if (existing.inputHash !== command.inputHash) return fail("IDEMPOTENCY_CONFLICT");
        let data: TurnClaim;
        if (existing.status === "completed" && existing.proposal !== null) data = { status: "completed", generationId: existing.generationId, proposal: structuredClone(existing.proposal) };
        else if (existing.status === "failed" && existing.errorCode !== null) data = { status: "failed", generationId: existing.generationId, errorCode: existing.errorCode };
        else data = { status: "running", generationId: existing.generationId };
        return { success: true, data };
      }
      if (command.expectedVersion !== session.version || session.status !== "active") return fail("VERSION_CONFLICT");
      if (command.contextHash !== session.contextHash) return fail("STALE_CONTEXT");
      if (pending !== null) return fail("TURN_IN_PROGRESS");
      const turn: Turn = { generationId: randomUUID(), requestKey: command.requestKey, inputHash: command.inputHash,
        contextHash: command.contextHash, claimVersion: session.version + 1, status: "running", proposal: null, errorCode: null };
      turns.set(command.requestKey, turn);
      pending = command.requestKey;
      session.version = turn.claimVersion;
      session.messages.push({ sequence: session.messages.length + 1, role: "user", content: command.message, contextHash: command.contextHash });
      return { success: true, data: { status: "claimed", generationId: turn.generationId, claimVersion: turn.claimVersion } };
    },
    async completeTurn(command) {
      const error = access(command.scope);
      if (error) return fail(error);
      const turn = find(command.generationId);
      if (!turn) return fail("NOT_FOUND");
      const proposal = command.proposal;
      if (proposal.businessId !== session.businessId || proposal.preorderId !== session.preorderId ||
        proposal.sessionId !== session.id || proposal.requestKey !== turn.requestKey || proposal.contextHash !== turn.contextHash ||
        proposal.proposalVersion !== turn.claimVersion) return fail("IDEMPOTENCY_CONFLICT");
      if (turn.status === "completed") return JSON.stringify(turn.proposal) === JSON.stringify(proposal) ? current() : fail("IDEMPOTENCY_CONFLICT");
      if (turn.status !== "running" || command.claimVersion !== session.version || pending !== turn.requestKey) return fail("VERSION_CONFLICT");
      if (failFinalize) return fail("PERSISTENCE_UNAVAILABLE");
      turn.status = "completed";
      turn.proposal = structuredClone(proposal);
      session.messages.push({ sequence: session.messages.length + 1, role: "assistant", content: proposal.reply, contextHash: proposal.contextHash });
      session.version++;
      pending = null;
      return current();
    },
    async failTurn(command) {
      const error = access(command.scope);
      if (error) return fail(error);
      const turn = find(command.generationId);
      if (!turn) return fail("NOT_FOUND");
      if (turn.status === "failed") return turn.errorCode === command.errorCode ? current() : fail("IDEMPOTENCY_CONFLICT");
      if (turn.status !== "running" || command.claimVersion !== session.version || pending !== turn.requestKey) return fail("VERSION_CONFLICT");
      turn.status = "failed";
      turn.errorCode = command.errorCode;
      session.version++;
      pending = null;
      return current();
    },
  };
}
