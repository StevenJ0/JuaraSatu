import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { z } from "zod";
export function discussionFixtureScope(ownerIndex=0){
  const scopes=z.array(z.object({businessId:z.uuid(),ownerUserId:z.uuid(),preorderId:z.uuid(),productId:z.uuid()})).length(2).parse(JSON.parse(readFileSync("node_modules/.cache/campaign-discussion/preorders.json","utf8")));
  assert.ok(ownerIndex===0||ownerIndex===1);return scopes[ownerIndex];
}

export const origin = process.env.DISCUSSION_BASE_URL ?? "http://localhost:3100";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(origin).hostname));
export function localFixtureSettings() {
  const env = Object.fromEntries(readFileSync(".env.local", "utf8").split(/\r?\n/).map((line) => { const at = line.indexOf("="); return [line.slice(0, at), line.slice(at + 1)]; }));
  assert.equal(env.NEXT_PUBLIC_SUPABASE_URL, "http://127.0.0.1:54321");
  return { env, accounts: JSON.parse(readFileSync("node_modules/.cache/database-v21-cutover/fixture-credentials.json", "utf8")),
    scenarios: JSON.parse(readFileSync("node_modules/.cache/campaign-execution/scenarios.json", "utf8")) };
}
export async function fixtureTokens() {
  const { env, accounts } = localFixtureSettings(); const tokens = [];
  for (const account of accounts) {
    const response = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/token?grant_type=password`, { method: "POST",
      headers: { apikey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, "Content-Type": "application/json" }, body: JSON.stringify({ email: account.email, password: account.password }) });
    assert.equal(response.status, 200); const login = await response.json(); assert.equal(login.user.id, account.id); tokens.push(login.access_token);
  }
  return tokens;
}
export async function call(token, route = "campaigns", body, query = "", headers = {}) {
  const response = await fetch(`${origin}/api/dev/${route}${query}`, { method: body ? "POST" : "GET", headers: {
    ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": "application/json", ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: response.status, body: await response.json() };
}
export async function createCampaignFixture(token, { approve = true, discount = true, ownerIndex = 0, scopeOverride } = {}) {
  const { scenarios } = localFixtureSettings(); const scope = scopeOverride ?? scenarios[ownerIndex];
  assert.equal(scope.businessId, scenarios[ownerIndex].businessId); assert.equal(scope.ownerUserId, scenarios[ownerIndex].ownerUserId);
  assert.match(scope.preorderId, /^[a-f0-9-]{36}$/);
  const created = await call(token, "discussions", { action: "create", preorderId: scope.preorderId }); assert.equal(created.status, 200);
  const session = created.body.session;
  const sent = await call(token, "discussions", { action: "send", sessionId: session.id, expectedVersion: session.version, expectedContextHash: session.contextHash,
    requestKey: `slice6-http-${randomUUID()}`, message: discount ? "Usulkan diskon unit 6 biaya 25000" : "Pengingat unit 4 biaya 10000",
    preferences: { budgetCapIdr: 50000, allowDiscount: true, channels: ["whatsapp"] }, scenario: discount ? "discount" : "normal" });
  assert.equal(sent.status, 200); assert.equal(sent.body.persisted, true);
  const choices = await call(token, "blueprints", undefined, `?sessionId=${session.id}`); assert.equal(choices.status, 200); assert.ok(choices.body.proposals[0].eligible);
  let draft = await call(token, "blueprints", { action: "create", selection: choices.body.proposals[0].selection, campaignId: randomUUID(), requestId: randomUUID(), scenario: "valid" }); assert.equal(draft.status, 200);
  if (approve) { draft = await call(token, "blueprints", { action: "approve", campaignId: draft.body.campaign.id, blueprintId: draft.body.active.id,
    expectedBlueprintVersion: draft.body.active.version, expectedCampaignVersion: draft.body.campaign.version, confirm: true }); assert.equal(draft.status, 200); }
  return { ...scope, sessionId: session.id, draft: draft.body, command: { action: "publish", campaignId: draft.body.campaign.id, blueprintId: draft.body.active.id,
    expectedBlueprintVersion: draft.body.active.version, expectedCampaignVersion: draft.body.campaign.version, expectedContextHash: draft.body.active.context_hash, confirm: true } };
}
export async function closeFixtureCampaign(token, campaignId) {
  const loaded = await call(token, "campaigns", undefined, `?campaignId=${campaignId}`);
  if (loaded.status === 200 && loaded.body.campaign.status === "published") {
    const closed = await call(token, "campaigns", { action: "close", campaignId, expectedCampaignVersion: loaded.body.campaign.version, confirm: true }); assert.equal(closed.status, 200);
  }
}
