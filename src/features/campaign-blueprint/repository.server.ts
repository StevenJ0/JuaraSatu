import "server-only";
import { z } from "zod";
import type { SupabaseTransport } from "@/lib/supabase/transport.server";
import { SupabaseError } from "@/lib/supabase/transport.server";
import { StrategyProposalSchema } from "../campaign-strategist";
import { BlueprintError, BlueprintRowSchema, CampaignRowSchema, type CampaignBlueprint, type BlueprintRow, type Selection } from "./contracts";
import { fingerprint } from "./blueprint-domain";
import { generationClaims } from "@/lib/ai/generation-claims.server";

export function mapBlueprintDatabaseError(error: unknown): never {
  if (error instanceof BlueprintError) throw error;
  if (error instanceof SupabaseError) {
    if (error.code === "42501") throw new BlueprintError("FORBIDDEN", 403);
    if (error.code === "P0002" || error.code === "23503") throw new BlueprintError("NOT_FOUND", 404);
    if (error.code === "23505" || (error.code === "40001" && error.detail === "IDEMPOTENCY_CONFLICT")) throw new BlueprintError("IDEMPOTENCY_CONFLICT");
    if (error.code === "40001" && ["VERSION_CONFLICT", "BLUEPRINT_NOT_APPROVABLE"].includes(error.detail)) throw new BlueprintError("VERSION_CONFLICT");
    if (error.code === "40001" && ["STALE_FACT_VERSIONS", "CONTEXT_HASH_MISMATCH"].includes(error.detail)) throw new BlueprintError("STALE_CONTEXT");
    if (error.code === "23514") throw new BlueprintError(error.detail === "EXECUTED_PLAN_REQUIRES_NEW_CAMPAIGN" ? "EXECUTED_PLAN_REQUIRES_NEW_CAMPAIGN" : "INVALID_BLUEPRINT", error.detail === "EXECUTED_PLAN_REQUIRES_NEW_CAMPAIGN" ? 409 : 400);
  }
  throw new BlueprintError("PERSISTENCE_UNAVAILABLE", 503);
}
export function blueprintRepository(user: SupabaseTransport, privileged: () => SupabaseTransport, scope: { businessId: string; ownerUserId: string }) {
  async function campaign(id: string) {
    const rows = z.array(CampaignRowSchema).parse(await user.select("campaigns", { select: "*", id: `eq.${id}`, business_id: `eq.${scope.businessId}`, limit: "1" }));
    if (!rows[0]) throw new BlueprintError("NOT_FOUND", 404); return rows[0];
  }
  async function blueprint(id: string): Promise<BlueprintRow | null> {
    const rows = z.array(BlueprintRowSchema).parse(await user.select("campaign_blueprints", { select: "*", id: `eq.${id}`, business_id: `eq.${scope.businessId}`, limit: "1" }));
    return rows[0] ?? null;
  }
  async function load(id: string) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const before = await campaign(id);
      // shortcut: Show the latest 100 versions in this development workflow; paginate before production use.
      const history = z.array(BlueprintRowSchema).parse(await user.select("campaign_blueprints", { select: "*", campaign_id: `eq.${id}`, business_id: `eq.${scope.businessId}`, order: "version.desc", limit: "100" }));
      const after = await campaign(id); if (before.version !== after.version) continue;
      const active = history.find((row) => row.id === after.active_blueprint_id) ?? null;
      if (after.active_blueprint_id && !active) throw new BlueprintError("PERSISTENCE_UNAVAILABLE", 503);
      for (const row of history) if (row.blueprint_json.campaignId !== id || row.blueprint_json.businessId !== scope.businessId ||
        row.blueprint_json.preorderId !== after.preorder_id || row.blueprint_json.blueprintVersion !== row.version || row.context_hash !== row.blueprint_json.contextHash) throw new BlueprintError("INVALID_PROVENANCE", 503);
      const [tasks, contents] = active ? await Promise.all([
        user.select("campaign_tasks", { select: "id,task_key,completed_at", blueprint_id: `eq.${active.id}`, business_id: `eq.${scope.businessId}` }),
        user.select("campaign_contents", { select: "id,content_key", blueprint_id: `eq.${active.id}`, business_id: `eq.${scope.businessId}` }),
      ]) : [[], []];
      return { campaign: after, active, history, materialized: { tasks: z.array(z.object({ id: z.uuid(), task_key: z.string(), completed_at: z.string().nullable() })).parse(tasks),
        contents: z.array(z.object({ id: z.uuid(), content_key: z.string() })).parse(contents) } };
    }
    throw new BlueprintError("VERSION_CONFLICT");
  }
  async function selection(input: Selection) {
    const sessions = z.array(z.object({ id: z.uuid(), preorder_id: z.uuid() })).parse(await user.select("campaign_ai_sessions", {
      select: "id,preorder_id", id: `eq.${input.sessionId}`, business_id: `eq.${scope.businessId}`, limit: "1" }));
    if (!sessions[0]) throw new BlueprintError("NOT_FOUND", 404);
    const [generations, messages] = await Promise.all([
      user.select("ai_generations", { select: "id,session_id,preorder_id,status,output_json", id: `eq.${input.generationId}`,
        session_id: `eq.${input.sessionId}`, business_id: `eq.${scope.businessId}`, limit: "1" }),
      user.select("campaign_ai_messages", { select: "id,session_id,ai_generation_id,context_hash,proposal_json", session_id: `eq.${input.sessionId}`,
        ai_generation_id: `eq.${input.generationId}`, business_id: `eq.${scope.businessId}`, role: "eq.assistant", limit: "1" }),
    ]);
    const gen = z.array(z.object({ id: z.uuid(), session_id: z.uuid(), preorder_id: z.uuid(), status: z.string(), output_json: z.unknown() })).parse(generations)[0];
    const message = z.array(z.object({ id: z.uuid(), session_id: z.uuid(), ai_generation_id: z.uuid(), context_hash: z.string(), proposal_json: z.unknown() })).parse(messages)[0];
    if (!gen || !message) throw new BlueprintError("NOT_FOUND", 404);
    const proposal = StrategyProposalSchema.parse(message.proposal_json); const output = StrategyProposalSchema.parse(gen.output_json);
    const alternative = proposal.options.find((option) => option.proposalKey === input.proposalKey);
    if (gen.status !== "success" || !alternative || proposal.persistence !== "saved" || proposal.status !== "alternatives_available" ||
      proposal.businessId !== scope.businessId || proposal.preorderId !== sessions[0].preorder_id || proposal.preorderId !== gen.preorder_id ||
      proposal.sessionId !== input.sessionId || proposal.proposalVersion !== input.proposalVersion || message.context_hash !== proposal.contextHash ||
      fingerprint(proposal) !== fingerprint(output)) throw new BlueprintError("INVALID_PROPOSAL", 400);
    return { proposal, alternative, source: { ...input, messageId: message.id, proposalHash: fingerprint(proposal) } };
  }
  async function replay(id: string, campaignId: string, requestHash: string) {
    const existing = await blueprint(id); if (!existing) return null;
    if (existing.campaign_id !== campaignId || existing.blueprint_json.revision.requestHash !== requestHash) throw new BlueprintError("IDEMPOTENCY_CONFLICT");
    return existing;
  }
  async function write(command: () => Promise<unknown>, body: CampaignBlueprint) {
    try { return { row: BlueprintRowSchema.parse(await command()), replayed: false }; }
    catch (error) {
      const existing = await replay(body.revision.requestId, body.campaignId, body.revision.requestHash);
      if (existing) return { row: existing, replayed: true };
      return mapBlueprintDatabaseError(error);
    }
  }
  return { campaign, blueprint, load, selection, replay, generations: generationClaims(user, privileged, scope.businessId, () => new Date().toISOString(), scope.ownerUserId),
    async create(body: CampaignBlueprint) {
      // Verify the user JWT can still read the source before constructing privileged transport.
      await selection(body.source);
      return write(() => privileged().rpc("create_campaign_with_initial_blueprint", { p_business_id: scope.businessId, p_preorder_id: body.preorderId,
        p_campaign_id: body.campaignId, p_blueprint_id: body.revision.requestId, p_context_hash: body.contextHash,
        p_source_generation_id: body.source.generationId, p_actor_user_id: scope.ownerUserId, p_expected_source_versions: body.sourceVersions,
        p_blueprint_json: body, p_draft: { name: body.campaignTitle, slug: `campaign-${body.campaignId}`, offerType: body.offer.type,
          marketingApproach: body.marketingApproach, discountBps: body.offer.discountBps, budgetCapIdr: body.budgetCapIdr,
          targetAdditionalUnits: body.targetAdditionalUnits, startsAt: body.executionWindow.startsAt, endsAt: body.executionWindow.endsAt } }), body);
    },
    async revise(body: CampaignBlueprint) {
      await campaign(body.campaignId); await selection(body.source);
      return write(() => privileged().rpc("save_blueprint_revision", { p_business_id: scope.businessId, p_campaign_id: body.campaignId,
        p_expected_campaign_version: body.revision.expectedCampaignVersion, p_blueprint_id: body.revision.requestId,
        p_context_hash: body.contextHash, p_blueprint_json: body, p_source_generation_id: body.source.generationId, p_actor_user_id: scope.ownerUserId }), body);
    },
    async approve(body: CampaignBlueprint, id: string, campaignVersion: number) {
      await campaign(body.campaignId); await selection(body.source);
      try { return BlueprintRowSchema.parse(await privileged().rpc("approve_blueprint", { p_business_id: scope.businessId, p_blueprint_id: id,
        p_expected_versions: { ...body.sourceVersions, campaignVersion }, p_context_hash: body.contextHash, p_actor_user_id: scope.ownerUserId })); }
      catch (error) { return mapBlueprintDatabaseError(error); }
    },
    async list(sessionId: string) {
      const messages = z.array(z.object({ id: z.uuid(), ai_generation_id: z.uuid().nullable(), proposal_json: z.unknown() })).parse(
        await user.select("campaign_ai_messages", { select: "id,ai_generation_id,proposal_json", session_id: `eq.${sessionId}`, business_id: `eq.${scope.businessId}`, role: "eq.assistant", order: "sequence.desc", limit: "100" }));
      const generations = z.array(z.object({ id: z.uuid(), status: z.string(), output_json: z.unknown() })).parse(
        await user.select("ai_generations", { select: "id,status,output_json", session_id: `eq.${sessionId}`, business_id: `eq.${scope.businessId}`, order: "created_at.desc", limit: "100" }));
      return messages.flatMap((message) => {
        const proposal = StrategyProposalSchema.safeParse(message.proposal_json);
        const generation = generations.find((row) => row.id === message.ai_generation_id && row.status === "success");
        if (!proposal.success || !generation || proposal.data.persistence !== "saved" || proposal.data.status !== "alternatives_available" ||
          proposal.data.sessionId !== sessionId || proposal.data.businessId !== scope.businessId || fingerprint(proposal.data) !== fingerprint(StrategyProposalSchema.parse(generation.output_json))) return [];
        return proposal.data.options.map((option) => ({ selection: { sessionId, generationId: generation.id, proposalVersion: proposal.data.proposalVersion, proposalKey: option.proposalKey }, title: option.title, contextHash: proposal.data.contextHash }));
      });
    },
  };
}
export type BlueprintRepository = ReturnType<typeof blueprintRepository>;
