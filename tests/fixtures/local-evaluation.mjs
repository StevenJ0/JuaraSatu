import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { call, createCampaignFixture, closeFixtureCampaign } from "./local-campaign.mjs";

export async function createEvaluationFixture(token, withExpense = true, scopeOverride) {
  const scopes = JSON.parse(readFileSync("node_modules/.cache/campaign-evaluation/preorders.json", "utf8"));
  const fixture = await createCampaignFixture(token, { scopeOverride: scopeOverride ?? scopes[0] });
  try {
    const published = await call(token, "campaigns", fixture.command); assert.equal(published.status, 200); const task = published.body.tasks[0];
    assert.equal((await call(token, "campaigns", { action: "task", campaignId: fixture.command.campaignId, blueprintId: task.blueprint_id, taskId: task.id, expectedTaskVersion: task.version, completed: true })).status, 200);
    await closeFixtureCampaign(token, fixture.command.campaignId);
    const costId = randomUUID();
    if (withExpense) {
      assert.equal((await call(token, "evaluations", { action: "create_cost", campaignId: fixture.command.campaignId, requestId: costId, category: "advertising",
        description: "Pengeluaran sintetis Slice 7; bukan transaksi usaha nyata", amountIdr: 50000, incurredAt: new Date().toISOString() })).status, 200);
      const view = await call(token, "evaluations", undefined, `?campaignId=${fixture.command.campaignId}`); assert.equal(view.status, 200);
      assert.equal((await call(token, "evaluations", { action: "review_costs", campaignId: fixture.command.campaignId, expectedCampaignVersion: view.body.context.snapshot.campaign.version, confirm: true })).status, 200);
    }
    return { ...fixture, campaignId: fixture.command.campaignId, costId };
  } finally { await closeFixtureCampaign(token, fixture.command.campaignId); }
}
export function generateEvaluationCommand(view, analyticsScenario = "exceeds_target", providerScenario = "valid") {
  return { action: "generate", campaignId: view.context.snapshot.campaign.id, requestId: randomUUID(), expectedCampaignVersion: view.context.snapshot.campaign.version,
    expectedEvaluationId: view.latestEvaluationId, expectedContextHash: view.context.contextHash, analyticsScenario, providerScenario };
}
