import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { call, fixtureTokens, createCampaignFixture, closeFixtureCampaign, localFixtureSettings } from "../fixtures/local-campaign.mjs";

const [a, b] = await fixtureTokens(); const f = await createCampaignFixture(a); let current;
let passed = 0; const test = async (name, work) => { await work(); passed++; console.log(`PASS ${name}`); };
try {
  await test("execution HTTP auth, ownership, explicit confirmation, strict input, origin and size guards", async () => {
    assert.equal((await call(undefined)).status, 401);
    const none = await call(b, "campaigns", undefined, `?preorderId=${localFixtureSettings().scenarios[1].preorderId}`); assert.equal(none.status, 200); assert.equal(none.body.state, "none");
    assert.equal((await call(b, "campaigns", undefined, `?campaignId=${f.command.campaignId}`)).status, 404);
    assert.equal((await call(a, "campaigns", undefined, "?campaignId=invalid")).status, 400);
    assert.equal((await call(a, "campaigns", { ...f.command, confirm: false })).status, 400);
    assert.equal((await call(a, "campaigns", { ...f.command, totalIdr: 1 })).status, 400);
    assert.equal((await call(a, "campaigns", { ...f.command, padding: "x".repeat(17000) })).status, 400);
    assert.equal((await call(a, "campaigns", f.command, "", { Origin: "https://untrusted.example" })).status, 403);
    assert.equal((await call(b, "campaigns", f.command)).status, 404);
    assert.equal((await call(a, "campaigns", { ...f.command, expectedBlueprintVersion: 999 })).status, 409);
  });
  await test("execution HTTP rejects unapproved publishing, draft closing and unpublished task completion", async () => {
    const proposed = await createCampaignFixture(a, { approve: false });
    const denied = await call(a, "campaigns", proposed.command); assert.equal(denied.status, 409); assert.equal(denied.body.code, "BLUEPRINT_NOT_APPROVED");
    assert.equal((await call(a, "campaigns", { action: "close", campaignId: f.command.campaignId, expectedCampaignVersion: f.command.expectedCampaignVersion, confirm: true })).status, 409);
    const view = await call(a, "campaigns", undefined, `?campaignId=${f.command.campaignId}`); assert.equal(view.status, 200); assert.ok(view.body.eligibility.eligible);
    const task = view.body.tasks[0];
    assert.equal((await call(a, "campaigns", { action: "task", campaignId: f.command.campaignId, blueprintId: task.blueprint_id, taskId: task.id, expectedTaskVersion: task.version, completed: true })).status, 409);
  });
  await test("execution HTTP atomically publishes approved version and replays publication", async () => {
    current = await call(a, "campaigns", f.command); assert.equal(current.status, 200); assert.equal(current.body.campaign.status, "published");
    assert.equal(current.body.campaign.baseline_json.baseline_preorder_paid_units, 0); assert.ok(current.body.campaign.published_at);
    assert.equal((await call(a, "campaigns", f.command)).body.replayed, true);
    const c3 = await call(a, "campaigns", undefined, `?preorderId=${f.preorderId}`); assert.equal(c3.status, 200);
    assert.equal(c3.body.state, "active"); assert.equal(c3.body.configuration.unitPriceIdr, 108000); assert.equal(c3.body.configuration.frozenBaseUnitPriceIdr, 120000);
    assert.equal((await call(b, "campaigns", undefined, `?preorderId=${f.preorderId}`)).status, 404);
  });
  await test("execution HTTP persists checklist, idempotent desired state, reopen and stale CAS rejection", async () => {
    const task = current.body.tasks[0]; const command = { action: "task", campaignId: f.command.campaignId, blueprintId: task.blueprint_id, taskId: task.id, expectedTaskVersion: task.version, completed: true };
    assert.equal((await call(b, "campaigns", command)).status, 404);
    assert.equal((await call(a, "campaigns", { ...command, taskId: randomUUID() })).status, 404);
    current = await call(a, "campaigns", command); assert.equal(current.status, 200); assert.equal(current.body.calendar.progress.completed, 1);
    assert.equal((await call(a, "campaigns", command)).body.replayed, true);
    const refreshed = await call(a, "campaigns", undefined, `?campaignId=${f.command.campaignId}`); assert.equal(refreshed.body.tasks[0].version, task.version + 1);
    current = await call(a, "campaigns", { ...command, expectedTaskVersion: task.version + 1, completed: false }); assert.equal(current.status, 200); assert.equal(current.body.calendar.progress.completed, 0);
    assert.equal((await call(a, "campaigns", command)).status, 409);
  });
  await test("execution HTTP explicitly closes, preserves blueprint/tasks/baseline and returns ineligible C3", async () => {
    const command = { action: "close", campaignId: f.command.campaignId, expectedCampaignVersion: current.body.campaign.version, confirm: true };
    assert.equal((await call(b, "campaigns", command)).status, 404); assert.equal((await call(a, "campaigns", { ...command, confirm: false })).status, 400);
    current = await call(a, "campaigns", command); assert.equal(current.status, 200); assert.equal(current.body.campaign.status, "closed"); assert.equal(current.body.campaign.completed_at, null);
    assert.equal(current.body.tasks.length, 2); assert.equal(current.body.contents.length, 1); assert.ok(current.body.campaign.baseline_json);
    assert.equal((await call(a, "campaigns", command)).body.replayed, true);
    const c3 = await call(a, "campaigns", undefined, `?preorderId=${f.preorderId}`); assert.equal(c3.body.state, "closed"); assert.equal(c3.body.eligible, false);
  });
  await test("execution HTTP rejects stale actual product context without partial publication", async () => {
    const stale = await createCampaignFixture(a); const sql = (query) => execFileSync("docker", ["exec", "supabase_db_campaign-lab", "psql", "-U", "postgres", "-d", "postgres", "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-c", query], { encoding: "utf8", stdio: "pipe" }).trim();
    assert.match(stale.productId, /^[a-f0-9-]{36}$/); assert.equal(sql(`SELECT base_price_idr FROM public.products WHERE id='${stale.productId}' AND sku='S6-${stale.productId}';`), "120000");
    try {
      sql(`UPDATE public.products SET base_price_idr=130000 WHERE id='${stale.productId}' AND base_price_idr=120000;`);
      const denied = await call(a, "campaigns", stale.command); assert.equal(denied.status, 409); assert.equal(denied.body.code, "STALE_CONTEXT");
      const view = await call(a, "campaigns", undefined, `?campaignId=${stale.command.campaignId}`); assert.equal(view.body.campaign.status, "draft"); assert.equal(view.body.campaign.baseline_json, null);
    } finally { sql(`UPDATE public.products SET base_price_idr=120000 WHERE id='${stale.productId}' AND base_price_idr=130000;`); }
  });
  console.log(`${passed} actual campaign execution HTTP groups passed`);
} finally { await closeFixtureCampaign(a, f.command.campaignId); }
