import "server-only";
import { z } from "zod";
import { SupabaseError, type SupabaseTransport } from "@/lib/supabase/transport.server";
import { BlueprintRowSchema } from "../campaign-blueprint/contracts";
import { CampaignExecutionError, ExecutionContentSchema, ExecutionTaskSchema, FrozenItemSchema, FrozenPreorderSchema, LifecycleCampaignSchema, type ExecutionSnapshot } from "./contracts";

export function executionDatabaseError(error: unknown): never {
  if (error instanceof CampaignExecutionError) throw error;
  if (error instanceof SupabaseError) {
    if (error.code === "42501") throw new CampaignExecutionError("FORBIDDEN", 403);
    if (error.code === "P0002" || error.code === "23503") throw new CampaignExecutionError("NOT_FOUND", 404);
    if (error.code === "23505") throw new CampaignExecutionError("CAMPAIGN_CONFLICT");
    if (error.code === "40001" && error.detail === "STALE_FACT_VERSIONS") throw new CampaignExecutionError("STALE_CONTEXT");
    if (error.code === "40001" && error.detail === "VERSION_CONFLICT") throw new CampaignExecutionError("VERSION_CONFLICT");
    if (error.code === "40001" || error.code === "40P01") throw new CampaignExecutionError("DATABASE_BUSY", 503);
    if (error.code === "23514") throw new CampaignExecutionError(["CAMPAIGN_NOT_PUBLISHABLE", "DISCOUNT_POLICY_BLOCKER"].includes(error.detail) ? error.detail : "INVALID_CAMPAIGN_STATE");
  }
  throw new CampaignExecutionError("PERSISTENCE_UNAVAILABLE", 503);
}
export function executionRepository(user: SupabaseTransport, privileged: () => SupabaseTransport, scope: { businessId: string; ownerUserId: string }) {
  async function campaign(id: string) {
    const rows = z.array(LifecycleCampaignSchema).parse(await user.select("campaigns", { select: "*", business_id: `eq.${scope.businessId}`, id: `eq.${id}` }));
    if (!rows[0]) throw new CampaignExecutionError("NOT_FOUND", 404); return rows[0];
  }
  async function base(id: string): Promise<Omit<ExecutionSnapshot, "tasks" | "contents">> {
    const c = await campaign(id); const bpId = c.published_at ? c.published_blueprint_id : c.active_blueprint_id;
    const [blueprints, preorders, items] = await Promise.all([
      bpId ? user.select("campaign_blueprints", { select: "*", id: `eq.${bpId}`, business_id: `eq.${scope.businessId}`, campaign_id: `eq.${id}` }) : [],
      user.select("preorders", { select: "id,business_id,status,starts_at,ends_at,fulfillment_date,version", id: `eq.${c.preorder_id}`, business_id: `eq.${scope.businessId}` }),
      user.select("preorder_items", { select: "id,business_id,preorder_id,base_price_snapshot_idr,version", preorder_id: `eq.${c.preorder_id}`, business_id: `eq.${scope.businessId}` }),
    ]);
    return { campaign: c, blueprint: z.array(BlueprintRowSchema).max(1).parse(blueprints)[0] ?? null,
      preorder: z.array(FrozenPreorderSchema).length(1).parse(preorders)[0], item: z.array(FrozenItemSchema).length(1).parse(items)[0] };
  }
  async function load(id: string): Promise<ExecutionSnapshot> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const initial = await base(id); const bp = initial.blueprint?.id;
      const [tasks, contents] = bp ? await Promise.all([
        user.select("campaign_tasks", { select: "*", campaign_id: `eq.${id}`, blueprint_id: `eq.${bp}`, business_id: `eq.${scope.businessId}`, order: "due_at,task_key", limit: "13" }),
        user.select("campaign_contents", { select: "*", campaign_id: `eq.${id}`, blueprint_id: `eq.${bp}`, business_id: `eq.${scope.businessId}`, order: "content_key", limit: "9" }),
      ]) : [[], []];
      if ((await campaign(id)).version !== initial.campaign.version) continue;
      return { ...initial, tasks: z.array(ExecutionTaskSchema).max(12).parse(tasks), contents: z.array(ExecutionContentSchema).max(8).parse(contents) };
    }
    throw new CampaignExecutionError("VERSION_CONFLICT");
  }
  async function conflicting(preorderId: string, campaignId: string) {
    return z.array(z.object({ id: z.uuid() })).parse(await user.select("campaigns", { select: "id", business_id: `eq.${scope.businessId}`,
      preorder_id: `eq.${preorderId}`, status: "eq.published", id: `neq.${campaignId}`, limit: "1" })).length > 0;
  }
  return { campaign, load, conflicting,
    async list() {
      // shortcut: Show the latest 100 campaigns locally; add pagination before production use.
      const rows = z.array(LifecycleCampaignSchema).parse(await user.select("campaigns", { select: "*", business_id: `eq.${scope.businessId}`,
        status: "in.(draft,published,closed)", order: "created_at.desc", limit: "100" }));
      const ids = rows.flatMap((row) => row.active_blueprint_id ? [row.active_blueprint_id] : []);
      const approved = ids.length ? z.array(z.object({ id: z.uuid() })).parse(await user.select("campaign_blueprints", { select: "id", id: `in.(${ids.join(",")})`,
        business_id: `eq.${scope.businessId}`, approval_status: "eq.approved", limit: "100" })) : [];
      return rows.filter((row) => row.published_at || approved.some((bp) => bp.id === row.active_blueprint_id));
    },
    async offer(preorderId: string) {
      const owned = z.array(z.object({ id: z.uuid() })).parse(await user.select("preorders", { select: "id", id: `eq.${preorderId}`, business_id: `eq.${scope.businessId}` }));
      if (!owned.length) throw new CampaignExecutionError("NOT_FOUND", 404);
      const filter = { select: "id", preorder_id: `eq.${preorderId}`, business_id: `eq.${scope.businessId}`, limit: "1" };
      let rows = z.array(z.object({ id: z.uuid() })).parse(await user.select("campaigns", { ...filter, status: "eq.published" }));
      if (!rows.length) rows = z.array(z.object({ id: z.uuid() })).parse(await user.select("campaigns", { ...filter, published_at: "not.is.null", order: "published_at.desc" }));
      return rows[0] ? base(rows[0].id) : null;
    },
    publish(snapshot: ExecutionSnapshot) {
      const c = snapshot.campaign; const bp = snapshot.blueprint; if (!bp) throw new CampaignExecutionError("BLUEPRINT_NOT_APPROVED");
      return privileged().rpc("publish_campaign", { p_business_id: scope.businessId, p_campaign_id: c.id,
        p_expected_versions: { ...bp.blueprint_json.sourceVersions, campaignVersion: c.version }, p_actor_user_id: scope.ownerUserId });
    },
    close(id: string, version: number) {
      // Existing owner RPC performs its own owner verification, locks and version check.
      return user.rpc("close_campaign", { p_business_id: scope.businessId, p_campaign_id: id, p_expected_version: version });
    },
    async updateTask(snapshot: ExecutionSnapshot, taskId: string, expectedVersion: number, completedAt: string | null) {
      if (!snapshot.campaign.published_at || !snapshot.campaign.published_blueprint_id) throw new CampaignExecutionError("INVALID_CAMPAIGN_STATE");
      return z.array(ExecutionTaskSchema).max(1).parse(await privileged().update("campaign_tasks", { id: `eq.${taskId}`, business_id: `eq.${scope.businessId}`,
        campaign_id: `eq.${snapshot.campaign.id}`, blueprint_id: `eq.${snapshot.campaign.published_blueprint_id}`, version: `eq.${expectedVersion}` }, { completed_at: completedAt }));
    },
  };
}
export type ExecutionRepository = ReturnType<typeof executionRepository>;
