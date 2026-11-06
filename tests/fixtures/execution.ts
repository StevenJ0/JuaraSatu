import { randomUUID } from "node:crypto";
import { blueprintFixture } from "./blueprint";
import { generateBlueprint } from "../../src/features/campaign-blueprint/blueprint-service";
import { ExecutionSnapshotSchema } from "../../src/features/campaign-execution/contracts";

export async function executionFixture(discountBps = 0) {
  const f = await blueprintFixture(); f.input.command.edits.discountBps = discountBps;
  f.input.command.edits.marketingApproach = discountBps ? "limited_discount" : "scheduled_reminder";
  const body = await generateBlueprint(f.input, f.dependencies);
  if (f.contextInput.c1.status !== "available") throw new Error("No C1 fixture"); const po = f.contextInput.c1.data.preorder;
  const now = f.dependencies.now(); const bpId = f.input.command.requestId;
  const snapshot = ExecutionSnapshotSchema.parse({ campaign: { ...f.input.campaign, status: "draft", version: 3, active_blueprint_id: bpId,
    published_blueprint_id: null, closed_at: null, completed_at: null, baseline_json: null, baseline_calculated_at: null, metrics_schema_version: null,
    marketing_approach: body.marketingApproach, primary_kpi: body.primaryKpi, offer_type: body.offer.type, discount_bps: body.offer.discountBps },
    blueprint: { id: bpId, business_id: body.businessId, campaign_id: body.campaignId, version: 1, approval_status: "approved", blueprint_json: body,
      source_ai_generation_id: body.source.generationId, context_hash: body.contextHash, approved_by_user_id: "11111111-1111-4111-8111-111111111111", approved_at: now },
    preorder: { id: body.preorderId, business_id: body.businessId, status: "published", starts_at: po.startsAt, ends_at: po.endsAt, fulfillment_date: po.fulfillmentDate, version: 1 },
    item: { id: po.preorderItemId, business_id: body.businessId, preorder_id: body.preorderId, base_price_snapshot_idr: body.financial.frozenBasePriceIdr, version: 1 },
    tasks: body.tasks.map((task) => ({ id: randomUUID(), business_id: body.businessId, campaign_id: body.campaignId, blueprint_id: bpId,
      task_key: task.key, title: task.title, description: task.description, channel: task.channel, due_at: task.dueAt, completed_at: null, version: 1 })),
    contents: body.contents.map((content) => ({ id: randomUUID(), business_id: body.businessId, campaign_id: body.campaignId, blueprint_id: bpId,
      content_key: content.key, channel: content.channel, content_type: content.type, body: content.body, version: 1 })) });
  const command = { campaignId: body.campaignId, blueprintId: bpId, expectedBlueprintVersion: 1, expectedCampaignVersion: 3, expectedContextHash: body.contextHash, confirm: true as const };
  const published = structuredClone(snapshot);
  Object.assign(published.campaign, { status: "published", version: 4, published_at: now, published_blueprint_id: bpId,
    baseline_json: { baseline_preorder_paid_units: 30, sourceVersions: { ...body.sourceVersions, campaignVersion: 3,
      businessId: body.businessId, preorderId: body.preorderId, itemId: po.preorderItemId, basePriceIdr: 120000 } }, baseline_calculated_at: now, metrics_schema_version: 1 });
  return { ...f, snapshot, published, command, now, scope: { businessId: body.businessId, preorderId: body.preorderId } };
}
