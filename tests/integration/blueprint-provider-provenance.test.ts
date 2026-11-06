import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { blueprintFixture } from "../fixtures/blueprint";
import { configuredBlueprintProvider } from "../../src/features/campaign-blueprint/gemini.server";
import { blueprintWorkflow } from "../../src/features/campaign-blueprint/workflow.server";
import { blueprintRepository } from "../../src/features/campaign-blueprint/repository.server";
import { BlueprintRowSchema, CampaignBlueprintSchema, type CampaignBlueprint, type CampaignRow } from "../../src/features/campaign-blueprint/contracts";
import type { SupabaseTransport } from "../../src/lib/supabase/transport.server";
import { generationClaimFixture } from "../fixtures/generation-claims";

vi.mock("server-only", () => ({}));
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const env = { NODE_ENV: "test", CAMPAIGN_DISCUSSION_CONTEXT: "seeded", CAMPAIGN_DISCUSSION_PROVIDER: "gemini",
  CAMPAIGN_BLUEPRINT_PROVIDER: "gemini", GEMINI_API_KEY: "synthetic-no-network-key", GEMINI_MODEL: "gemini-3.6-flash", GEMINI_TIMEOUT_MS: "60000" };

async function setup(id: string | undefined, invalidJson = false) {
  const f = await blueprintFixture(), selected = f.input.selected;
  const plan = await f.dependencies.provider.generate({ alternative: selected.alternative, edits: f.input.command.edits, now: f.dependencies.now() });
  const scope = { businessId: selected.proposal.businessId, ownerUserId: "11111111-1111-4111-8111-111111111111" };
  let stored: { body: CampaignBlueprint; row: z.infer<typeof BlueprintRowSchema>; campaign: CampaignRow } | undefined;
  const user: SupabaseTransport = {
    async select(table, query) {
      if (query.business_id) expect(query.business_id).toBe("eq." + scope.businessId);
      switch (table) {
        case "campaign_ai_sessions": return [{ id: selected.source.sessionId, preorder_id: selected.proposal.preorderId }];
        case "ai_generations": return [{ id: selected.source.generationId, session_id: selected.source.sessionId,
          preorder_id: selected.proposal.preorderId, status: "success", output_json: selected.proposal }];
        case "campaign_ai_messages": return [{ id: selected.source.messageId, session_id: selected.source.sessionId,
          ai_generation_id: selected.source.generationId, context_hash: selected.proposal.contextHash, proposal_json: selected.proposal }];
        case "campaigns": return stored && query.id === "eq." + stored.campaign.id ? [stored.campaign] : [];
        case "campaign_blueprints": return stored && (query.id === "eq." + stored.row.id || query.campaign_id === "eq." + stored.campaign.id) ? [stored.row] : [];
        case "campaign_tasks": case "campaign_contents": return [];
        default: throw Error("Unexpected table in Blueprint integration");
      }
    },
    async insert() { throw Error("Unexpected insert"); },
    async update() { throw Error("Unexpected update"); },
    async rpc() { throw Error("Unexpected user RPC"); },
  };
  const rpc = vi.fn(async (name: string, args: unknown) => {
    expect(name).toBe("create_campaign_with_initial_blueprint");
    const command = z.object({ p_business_id: z.uuid(), p_campaign_id: z.uuid(), p_blueprint_id: z.uuid(), p_actor_user_id: z.uuid(),
      p_context_hash: z.string(), p_source_generation_id: z.uuid(), p_blueprint_json: CampaignBlueprintSchema }).parse(args);
    expect(command.p_actor_user_id).toBe(scope.ownerUserId); expect(command.p_business_id).toBe(scope.businessId);
    expect(command.p_blueprint_id).toBe(command.p_blueprint_json.revision.requestId);
    const row = BlueprintRowSchema.parse({ id: command.p_blueprint_id, business_id: scope.businessId, campaign_id: command.p_campaign_id,
      version: 1, approval_status: "proposed", blueprint_json: structuredClone(command.p_blueprint_json),
      source_ai_generation_id: command.p_source_generation_id, context_hash: command.p_context_hash,
      approved_by_user_id: null, approved_at: null });
    stored = { body: structuredClone(command.p_blueprint_json), row, campaign: { ...f.input.campaign, version: 2, active_blueprint_id: row.id } };
    return row;
  });
  const writer: SupabaseTransport = { ...user, rpc };
  const repository = { ...blueprintRepository(user, () => writer, scope), generations: generationClaimFixture(scope.businessId, f.dependencies.now).instance() };
  const transport = vi.fn<typeof fetch>(async (input, init) => {
    const request = new Request(input, init);
    expect(new URL(request.url).origin).toBe("https://generativelanguage.googleapis.com");
    expect(new URL(request.url).pathname).toBe("/v1beta/interactions");
    expect(request.method).toBe("POST");
    expect(await request.json()).toMatchObject({ model: env.GEMINI_MODEL, store: false, stream: false });
    return Response.json({ ...(id === undefined ? {} : { id }), status: "completed",
      steps: [{ type: "model_output", content: [{ type: "text", text: invalidJson ? "{invalid" : JSON.stringify(plan) }] }] });
  });
  vi.stubGlobal("fetch", transport);
  const workflow = blueprintWorkflow(repository, { loadContext: async () => structuredClone(f.contextInput), now: f.dependencies.now,
    approvalEnabled: false, provider: () => configuredBlueprintProvider("valid", env) });
  const command = { campaignId: f.input.campaign.id, requestId: f.input.command.requestId, selection: {
    sessionId: selected.source.sessionId, generationId: selected.source.generationId, proposalVersion: selected.source.proposalVersion, proposalKey: selected.source.proposalKey } };
  return { workflow, repository, command, transport, rpc, selected, stored: () => stored };
}

describe("Blueprint provider/SDK/workflow/repository integration, mocked external transports", () => {
  it.each(["mock-google-blueprint-id", undefined])("persists provider id %s honestly and replays using the internal request id", async id => {
    const f = await setup(id), created = await f.workflow.create(f.command);
    expect(created.active?.blueprint_json).toMatchObject({ provider: "gemini", model: env.GEMINI_MODEL, providerRequestId: id ?? null,
      source: f.selected.source, contextHash: f.selected.proposal.contextHash,
      revision: { requestId: f.command.requestId, requestHash: expect.stringMatching(/^[a-f0-9]{64}$/) } });
    expect(created.active).toMatchObject({ id: f.command.requestId, source_ai_generation_id: f.selected.source.generationId, approval_status: "proposed" });
    expect(created.campaign).toMatchObject({ status: "draft", published_at: null });
    expect(f.stored()?.body.providerRequestId).toBe(id ?? null);
    expect((await f.repository.load(f.command.campaignId)).active?.blueprint_json).toEqual(created.active?.blueprint_json);
    const decoded: unknown = JSON.parse(JSON.stringify(created));
    expect(z.object({ active: BlueprintRowSchema }).parse(decoded).active.blueprint_json.providerRequestId).toBe(id ?? null);
    expect((await f.workflow.create(f.command)).replayed).toBe(true);
    await expect(f.workflow.create({ ...f.command, scenario: "invalid" })).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    expect(f.transport).toHaveBeenCalledTimes(1); expect(f.rpc).toHaveBeenCalledTimes(1);
    expect(f.rpc.mock.calls[0][1]).toMatchObject({ p_source_generation_id: f.selected.source.generationId,
      p_blueprint_json: { providerRequestId: id ?? null, sourceVersions: expect.any(Object) } });
  });
  it("does not persist any Blueprint or campaign for invalid JSON without interaction id", async () => {
    const f = await setup(undefined, true);
    await expect(f.workflow.create(f.command)).rejects.toMatchObject({ code: "INVALID_BLUEPRINT" });
    expect(f.stored()).toBeUndefined(); expect(f.rpc).not.toHaveBeenCalled(); expect(f.transport).toHaveBeenCalledTimes(1);
  });
});

