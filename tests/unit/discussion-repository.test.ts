import { describe, expect, it } from "vitest";
import { generateCampaignStrategies } from "../../src/features/campaign-strategist";
import type { DiscussionScope, DiscussionSession } from "../../src/features/campaign-strategist/discussion-repository";
import { discussionFixture, strategistDependencies } from "../fixtures/campaign-strategist";
import { fakeDiscussionRepository } from "../fixtures/fake-discussion-repository";

const scope: DiscussionScope = { ownerUserId: "44444444-4444-4444-8444-444444444441",
  businessId: discussionFixture.businessId, preorderId: discussionFixture.preorderId,
  sessionId: "44444444-4444-4444-8444-444444444442" };
const session: DiscussionSession = { id: scope.sessionId, businessId: scope.businessId, preorderId: scope.preorderId,
  version: 1, contextHash: discussionFixture.expectedContextHash, status: "active", messages: [] };
const begin = { scope, expectedVersion: 1, contextHash: session.contextHash,
  requestKey: discussionFixture.requestKey, inputHash: "a".repeat(64), message: discussionFixture.message };
function repository(failFinalize = false) { return fakeDiscussionRepository({ ownerUserId: scope.ownerUserId, session }, failFinalize); }

describe("discussion repository contract with a test-only fake", () => {
  it("claims once under concurrent retries and protects expected version/idempotency payload", async () => {
    const repo = repository();
    const claims = await Promise.all([repo.beginTurn(begin), repo.beginTurn(begin)]);
    expect(claims.map((result) => result.success ? result.data.status : result.code)).toEqual(["claimed", "running"]);
    expect(await repo.beginTurn({ ...begin, inputHash: "b".repeat(64) })).toEqual({ success: false, code: "IDEMPOTENCY_CONFLICT" });
    expect(await repo.beginTurn({ ...begin, requestKey: "another" })).toEqual({ success: false, code: "VERSION_CONFLICT" });
    expect(await repo.beginTurn({ ...begin, expectedVersion: 2, requestKey: "another" })).toEqual({ success: false, code: "TURN_IN_PROGRESS" });
    expect(await repo.load(scope)).toMatchObject({ success: true, data: { version: 2, messages: [{ role: "user" }] } });
  });

  it("preserves multi-turn provenance and replays duplicate completed requests", async () => {
    const repo = repository();
    const claim = await repo.beginTurn(begin);
    if (!claim.success || claim.data.status !== "claimed") throw new Error("Expected claim");
    // The provider call happens between repository calls, outside a transaction.
    const generated = await generateCampaignStrategies({ ...discussionFixture, sessionId: scope.sessionId }, strategistDependencies());
    if (!generated.success) throw new Error("Expected proposal");
    const completion = { scope, generationId: claim.data.generationId, claimVersion: claim.data.claimVersion, proposal: generated.data };
    expect(await repo.completeTurn(completion)).toMatchObject({ success: true, data: { version: 3, messages: [
      { sequence: 1, role: "user", contextHash: session.contextHash }, { sequence: 2, role: "assistant", contextHash: session.contextHash },
    ] } });
    expect(await repo.completeTurn(completion)).toMatchObject({ success: true, data: { version: 3 } });
    expect(await repo.beginTurn(begin)).toMatchObject({ success: true, data: { status: "completed", proposal: { contextHash: session.contextHash } } });
    const loaded = await repo.load(scope);
    if (!loaded.success) throw new Error("Expected session");
    const second = await repo.beginTurn({ ...begin, expectedVersion: 3, requestKey: "second", inputHash: "b".repeat(64), message: "Bagaimana jika memakai konten nilai?" });
    expect(second).toMatchObject({ success: true, data: { status: "claimed", claimVersion: 4 } });
    loaded.data.messages[0].content = "Changed returned copy";
    expect(await repo.load(scope)).toMatchObject({ success: true, data: { messages: [{ content: begin.message }, expect.anything(), expect.anything()] } });
  });

  it.each(["ownerUserId", "businessId", "preorderId"] as const)("rejects foreign %s on every operation", async (field) => {
    const repo = repository();
    const foreign = { ...scope, [field]: "55555555-5555-4555-8555-555555555555" };
    expect(await repo.load(foreign)).toEqual({ success: false, code: "FORBIDDEN" });
    expect(await repo.beginTurn({ ...begin, scope: foreign })).toEqual({ success: false, code: "FORBIDDEN" });
    expect(await repo.failTurn({ scope: foreign, generationId: "missing", claimVersion: 2, errorCode: "PROVIDER_TIMEOUT" })).toEqual({ success: false, code: "FORBIDDEN" });
  });

  it("rejects stale context without claiming or appending a message", async () => {
    const repo = repository();
    expect(await repo.beginTurn({ ...begin, contextHash: "b".repeat(64) })).toEqual({ success: false, code: "STALE_CONTEXT" });
    expect(await repo.load(scope)).toMatchObject({ success: true, data: { version: 1, messages: [] } });
  });

  it("records provider failure without fake success and makes failed retries explicit", async () => {
    const repo = repository();
    const claim = await repo.beginTurn(begin);
    if (!claim.success || claim.data.status !== "claimed") throw new Error("Expected claim");
    const command = { scope, generationId: claim.data.generationId, claimVersion: claim.data.claimVersion, errorCode: "PROVIDER_TIMEOUT" as const };
    expect(await repo.failTurn(command)).toMatchObject({ success: true, data: { version: 3, messages: [{ role: "user" }] } });
    expect(await repo.failTurn(command)).toMatchObject({ success: true, data: { version: 3 } });
    expect(await repo.beginTurn(begin)).toMatchObject({ success: true, data: { status: "failed", errorCode: "PROVIDER_TIMEOUT" } });
  });

  it("does not append success when final persistence fails or CAS is stale", async () => {
    const repo = repository(true);
    const claim = await repo.beginTurn(begin);
    const generated = await generateCampaignStrategies({ ...discussionFixture, sessionId: scope.sessionId }, strategistDependencies());
    if (!claim.success || claim.data.status !== "claimed" || !generated.success) throw new Error("Expected fixture");
    const command = { scope, generationId: claim.data.generationId, claimVersion: 1, proposal: generated.data };
    expect(await repo.completeTurn(command)).toEqual({ success: false, code: "VERSION_CONFLICT" });
    expect(await repo.completeTurn({ ...command, claimVersion: 2 })).toEqual({ success: false, code: "PERSISTENCE_UNAVAILABLE" });
    expect(await repo.load(scope)).toMatchObject({ success: true, data: { version: 2, messages: [{ role: "user" }] } });
  });
});
