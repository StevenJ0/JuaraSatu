import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { call, fixtureTokens } from "../fixtures/local-campaign.mjs";
import { createEvaluationFixture, generateEvaluationCommand } from "../fixtures/local-evaluation.mjs";

const [a, b] = await fixtureTokens(); const f = await createEvaluationFixture(a, false);
const read = (scenario = "exceeds_target") => call(a, "evaluations", undefined, `?campaignId=${f.campaignId}&scenario=${scenario}`);
let passed = 0; const test = async (name, work) => { await work(); passed++; console.log(`PASS ${name}`); };
let current = await read(); assert.equal(current.status, 200); let savedId; let reviewId;
await test("evaluation HTTP auth, tenant, strict scope, size and origin guards", async () => {
  assert.equal((await call(undefined, "evaluations")).status, 401);
  assert.equal((await call(b, "evaluations", undefined, `?campaignId=${f.campaignId}`)).status, 404);
  assert.equal((await call(a, "evaluations", undefined, "?campaignId=invalid")).status, 400);
  const command = generateEvaluationCommand(current.body);
  assert.equal((await call(b, "evaluations", command)).status, 404);
  assert.equal((await call(a, "evaluations", { ...command, authoritativeRevenue: 999999 })).status, 400);
  assert.equal((await call(a, "evaluations", { ...command, padding: "x".repeat(17000) })).status, 400);
  assert.equal((await call(a, "evaluations", command, "", { Origin: "https://untrusted.example" })).status, 403);
  assert.equal((await call(a, "evaluations", undefined, `?campaignId=${f.campaignId}&scenario=invented`)).status, 400);
});
await test("evaluation HTTP cost review distinguishes unknown/zero and void/replacement preserves history", async () => {
  assert.equal(current.body.summary.actualPromotionSpendIdr, null); assert.equal(current.body.summary.recordedSpendSubtotalIdr, 0);
  const review = { action: "review_costs", campaignId: f.campaignId, expectedCampaignVersion: current.body.context.snapshot.campaign.version, confirm: true };
  assert.equal((await call(a, "evaluations", { ...review, confirm: false })).status, 400);
  assert.equal((await call(a, "evaluations", review)).status, 200); current = await read(); assert.equal(current.body.summary.actualPromotionSpendIdr, 0);
  const cost = { action: "create_cost", campaignId: f.campaignId, requestId: randomUUID(), category: "advertising", description: "Synthetic HTTP expense", amountIdr: 50000, incurredAt: new Date().toISOString() };
  assert.equal((await call(a, "evaluations", { ...cost, amountIdr: "50000" })).status, 400);
  assert.equal((await call(a, "evaluations", cost)).status, 200); assert.equal((await call(a, "evaluations", cost)).body.replayed, true);
  assert.equal((await call(a, "evaluations", { ...cost, amountIdr: 1 })).status, 409);
  current = await read(); assert.equal(current.body.context.costsCompleteness, "unreviewed"); assert.equal(current.body.context.costs.length, 1);
  const correction = { action: "void_cost", campaignId: f.campaignId, costId: cost.requestId, expectedCostVersion: 1, reason: "Synthetic correction" };
  assert.equal((await call(a, "evaluations", { ...correction, reason: "" })).status, 400);
  assert.equal((await call(a, "evaluations", correction)).status, 200); assert.equal((await call(a, "evaluations", correction)).body.replayed, true);
  assert.equal((await call(a, "evaluations", { ...cost, requestId: randomUUID(), description: "Replacement synthetic expense" })).status, 200);
  current = await read(); assert.equal(current.body.context.costs.length, 2); assert.equal(current.body.context.costs.filter((c) => c.voided_at).length, 1);
  assert.equal((await call(a, "evaluations", { ...review, expectedCampaignVersion: current.body.context.snapshot.campaign.version })).status, 200);
  current = await read(); assert.equal(current.body.summary.actualPromotionSpendIdr, 50000); assert.equal(current.body.summary.contributionIdr, 214000);
});
await test("evaluation HTTP rejects stale input and persists/replays complete provisional snapshot", async () => {
  const command = generateEvaluationCommand(current.body);
  assert.equal((await call(a, "evaluations", { ...command, expectedCampaignVersion: 1 })).status, 409);
  assert.equal((await call(a, "evaluations", { ...command, expectedContextHash: "0".repeat(64) })).status, 409);
  const result = await call(a, "evaluations", command); assert.equal(result.status, 200); savedId = command.requestId;
  assert.equal(result.body.history[0].row.analysis_json.status, "available"); assert.equal(result.body.history[0].row.evaluation_kind, "provisional");
  assert.equal((await call(a, "evaluations", command)).body.replayed, true);
  assert.equal((await call(a, "evaluations", { ...command, providerScenario: "invalid" })).status, 409);
  current = await read(); assert.equal(current.body.history.length, 1);
});
await test("evaluation HTTP stores explicit review as immutable child and excludes it from production memory", async () => {
  const review = { action: "review", campaignId: f.campaignId, requestId: randomUUID(), evaluationId: savedId, expectedCampaignVersion: current.body.context.snapshot.campaign.version,
    expectedContextHash: current.body.context.contextHash, confirm: true };
  assert.equal((await call(a, "evaluations", { ...review, confirm: false })).status, 400); assert.equal((await call(b, "evaluations", review)).status, 404);
  const result = await call(a, "evaluations", review); assert.equal(result.status, 200); reviewId = review.requestId;
  assert.equal(result.body.history.length, 2); assert.equal(result.body.history.find((r) => r.row.id === savedId).row.analysis_json.review.status, "unreviewed");
  assert.equal(result.body.history.find((r) => r.row.id === reviewId).row.analysis_json.review.status, "reviewed");
  assert.ok(result.body.history[0].memoryExclusions.includes("SYNTHETIC_EVALUATION")); assert.equal((await call(a, "evaluations", review)).body.replayed, true);
});
await test("evaluation HTTP preserves provider errors and unknown KPI instead of inventing success", async () => {
  for (const provider of ["failure", "invalid"]) {
    current = await read(); const command = generateEvaluationCommand(current.body, "exceeds_target", provider); const result = await call(a, "evaluations", command); assert.equal(result.status, 200);
    const row = result.body.history.find((r) => r.row.id === command.requestId).row; assert.equal(row.analysis_json.status, provider === "failure" ? "failed" : "invalid"); assert.equal(row.analysis_json.narrative, null);
  }
  const missing = await read("unavailable"); assert.equal(missing.body.summary.observed.paidUnitsInWindow, null); assert.equal(missing.body.summary.contributionIdr, null);
  const missingCost = await read("missing_cost"); assert.equal(missingCost.body.summary.observed.scopedProductionCostIncurredIdr, null);
});
await test("evaluation HTTP rejects stale review/finalization and preserves closed state", async () => {
  current = await read();
  const expense = { action: "create_cost", campaignId: f.campaignId, requestId: randomUUID(), category: "other", description: "Concurrent synthetic expense", amountIdr: 1, incurredAt: new Date().toISOString() };
  assert.equal((await call(a, "evaluations", expense)).status, 200);
  const review = { action: "review", campaignId: f.campaignId, requestId: randomUUID(), evaluationId: savedId, expectedCampaignVersion: current.body.context.snapshot.campaign.version, expectedContextHash: current.body.context.contextHash, confirm: true };
  assert.equal((await call(a, "evaluations", review)).status, 409);
  current = await read(); assert.ok(current.body.history.find((r) => r.row.id === reviewId).stale);
  const finalize = { ...review, action: "finalize", expectedCampaignVersion: current.body.context.snapshot.campaign.version };
  assert.equal((await call(a, "evaluations", { ...finalize, confirm: false })).status, 400);
  const denied = await call(a, "evaluations", finalize); assert.equal(denied.status, 409); assert.equal(denied.body.code, "STALE_CONTEXT");
  current = await read(); assert.equal(current.body.context.snapshot.campaign.status, "closed"); assert.equal(current.body.context.snapshot.campaign.completed_at, null);
});
await test("evaluation HTTP explicit finalization persists completion and reconciles retries without production eligibility", async () => {
  assert.equal((await call(a, "evaluations", { action: "review_costs", campaignId: f.campaignId, expectedCampaignVersion: current.body.context.snapshot.campaign.version, confirm: true })).status, 200);
  current = await read(); const command = generateEvaluationCommand(current.body); const generated = await call(a, "evaluations", command); assert.equal(generated.status, 200);
  const review = { action: "review", campaignId: f.campaignId, requestId: randomUUID(), evaluationId: command.requestId,
    expectedCampaignVersion: generated.body.context.snapshot.campaign.version, expectedContextHash: generated.body.context.contextHash, confirm: true };
  const reviewed = await call(a, "evaluations", review); assert.equal(reviewed.status, 200); assert.equal(reviewed.body.finalization.eligible, true);
  const finalize = { ...review, action: "finalize", requestId: randomUUID(), evaluationId: review.requestId };
  assert.equal((await call(a, "evaluations", { ...finalize, confirm: false })).status, 400);
  assert.equal((await call(b, "evaluations", finalize)).status, 404);
  const completed = await call(a, "evaluations", finalize); assert.equal(completed.status, 200); assert.equal(completed.body.context.snapshot.campaign.status, "completed");
  assert.equal(completed.body.history[0].row.metrics_json.finalization.mode, "development_synthetic"); assert.equal(completed.body.history[0].stale, false);
  assert.equal(completed.body.finalization.productionEligible, false); assert.ok(completed.body.history[0].memoryExclusions.includes("SYNTHETIC_EVALUATION"));
  assert.equal((await call(a, "evaluations", finalize)).body.replayed, true);
  const conflict = await call(a, "evaluations", { ...finalize, expectedContextHash: "0".repeat(64) }); assert.equal(conflict.status, 409); assert.equal(conflict.body.code, "IDEMPOTENCY_CONFLICT");
  current = await read(); assert.equal(current.body.context.snapshot.campaign.status, "completed"); assert.ok(current.body.context.snapshot.campaign.completed_at);
});
console.log(`${passed} evaluation HTTP groups passed; simulated completion remains excluded from production memory`);
