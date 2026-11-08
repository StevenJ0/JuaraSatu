import "server-only";
import { z } from "zod";
import { authenticateOwnerApi, requireOwnerOrigin } from "@/features/auth/owner-api.server";
import { loadOwnedPreorderContext } from "../ai-context/owned-preorder-context.server";
import { privilegedTransport } from "@/lib/supabase/transport.server";
import { createDiscussionHandlers } from "./discussion-api.server";
import { createSupabaseDiscussionRepository } from "./supabase-discussion-repository.server";
import { ownerBlueprintProvider, ownerProviderIdentity, ownerStrategyProvider } from "./owner-provider.server";
import { blueprintRepository } from "../campaign-blueprint/repository.server";
import { blueprintWorkflow } from "../campaign-blueprint/workflow.server";
import { createBlueprintHandlers } from "../campaign-blueprint/api.server";
import { createExecutionHandlers } from "../campaign-execution/api.server";
import { executionDatabaseError, executionRepository } from "../campaign-execution/repository.server";
import { campaignExecutionService } from "../campaign-execution/service";

async function common() {
  const owner = await authenticateOwnerApi(); const now = () => new Date().toISOString();
  return { owner, now, ownerMode: true, checkOrigin: requireOwnerOrigin,
    loadContext: (scope: { businessId: string; preorderId: string }) => loadOwnedPreorderContext(owner.client, scope, now) };
}
export const ownerDiscussion = createDiscussionHandlers(async () => {
  const bound = await common(); const { owner } = bound; const identity = ownerProviderIdentity();
  return { ...bound, identity, syntheticContext: false, provider: ownerStrategyProvider,
    repository: createSupabaseDiscussionRepository(owner.user, privilegedTransport, identity.model),
    campaigns: async () => {
      const rows = z.array(z.object({ id: z.uuid(), name: z.string(), preorder_id: z.uuid(), active_blueprint_id: z.uuid().nullable() }))
        .parse(await owner.user.select("campaigns", { select: "id,name,preorder_id,active_blueprint_id", business_id: `eq.${owner.businessId}`, order: "created_at.desc", limit: "100" }));
      const blueprints = z.array(z.object({ id: z.uuid(), blueprint_json: z.object({ source: z.object({ sessionId: z.uuid() }) }) }))
        .parse(await owner.user.select("campaign_blueprints", { select: "id,blueprint_json", business_id: `eq.${owner.businessId}`, order: "created_at.desc", limit: "100" }));
      return rows.flatMap(row => { const bp = blueprints.find(b => b.id === row.active_blueprint_id);
        return bp ? [{ id: row.id, name: row.name, preorderId: row.preorder_id, sessionId: bp.blueprint_json.source.sessionId }] : []; });
    } };
});
export const ownerBlueprint = createBlueprintHandlers(async () => {
  const bound = await common(); const repository = blueprintRepository(bound.owner.user, privilegedTransport, bound.owner);
  return { ...bound, repository, workflow: blueprintWorkflow(repository, { loadContext: bound.loadContext, now: bound.now,
    provider: ownerBlueprintProvider, approvalEnabled: true }) };
});
export const ownerExecution = createExecutionHandlers(async () => {
  const bound = await common(); const { owner } = bound;
  const repository = executionRepository(owner.user, privilegedTransport, owner);
  const source = blueprintRepository(owner.user, privilegedTransport, owner);
  return { ...bound, repository, service: campaignExecutionService(repository, { now: bound.now,
    // P2-1: harga checkout membaca campaign published lewat resolver C8, jadi owner boleh publish dengan konteks asli P1-2.
    publishingEnabled: true, selection: source.selection, databaseError: executionDatabaseError, loadContext: bound.loadContext }) };
});
