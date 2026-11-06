import { randomUUID } from "node:crypto";
import { executionFixture } from "./execution";
import { validateBlueprint } from "../../src/features/campaign-blueprint";
import { buildEvaluationContext } from "../../src/features/campaign-evaluation/context";
import { syntheticCampaignAnalytics } from "../../src/features/campaign-evaluation/development-provider";
import { CostSchema } from "../../src/features/campaign-evaluation/contracts";
export const evaluationEnvironment = { NODE_ENV: "test", CAMPAIGN_EVALUATION_MODE: "synthetic" };
export async function evaluationFixture(scenario = "exceeds_target", reviewed = true) {
  const f = await executionFixture(1000); const snapshot = f.published; if (!snapshot.blueprint) throw new Error("No blueprint");
  const body = snapshot.blueprint.blueprint_json;
  snapshot.blueprint.blueprint_json = validateBlueprint({ ...body, targetAdditionalUnits: 6, budgetCapIdr: 25000, kpiPlan: { ...body.kpiPlan, target: 6 } }, f.contextInput, f.now);
  Object.assign(snapshot.campaign, { status: "closed", closed_at: "2026-11-02T03:01:00Z", target_additional_units: 6, budget_cap_idr: 25000 });
  snapshot.tasks[0].completed_at = "2026-11-02T03:00:30Z";
  const now = "2026-11-02T03:02:00Z";
  const costs = [CostSchema.parse({ id: randomUUID(), business_id: snapshot.campaign.business_id, campaign_id: snapshot.campaign.id, category: "advertising",
    description: "Pengeluaran sintetis", amount_idr: 50000, incurred_at: f.now, voided_at: null, void_reason: null, version: 1 })];
  const input = { snapshot, costs, costsCompleteness: reviewed ? "confirmed_complete" : "unreviewed", analytics: syntheticCampaignAnalytics(snapshot, scenario, now, evaluationEnvironment), analyticsScenario: scenario, now };
  return { ...f, snapshot, costs, now, input, context: buildEvaluationContext(input) };
}
