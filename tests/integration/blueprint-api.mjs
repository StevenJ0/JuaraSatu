// Real local Next + GoTrue + PostgreSQL. Requires the documented synthetic fixture accounts.
import assert from "node:assert/strict";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { discussionFixtureScope } from "../fixtures/local-campaign.mjs";

const origin = process.env.DISCUSSION_BASE_URL ?? "http://localhost:3100";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(origin).hostname));
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split(/\r?\n/).map((line) => { const i = line.indexOf("="); return [line.slice(0, i), line.slice(i + 1)]; }));
assert.equal(env.NEXT_PUBLIC_SUPABASE_URL, "http://127.0.0.1:54321");
const accounts = JSON.parse(readFileSync("node_modules/.cache/database-v21-cutover/fixture-credentials.json", "utf8"));
const tokens = [];
for (const account of accounts) {
  const response = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/token?grant_type=password`, { method: "POST",
    headers: { apikey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email: account.email, password: account.password }) });
  assert.equal(response.status, 200); const login = await response.json();
  assert.equal(login.user.id, account.id); tokens.push(login.access_token);
}
const [a, b] = tokens;
async function call(token, body, query = "", headers = {}, route = "blueprints") {
  const response = await fetch(`${origin}/api/dev/${route}${query}`, { method: body ? "POST" : "GET",
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": "application/json", ...headers },
    ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: response.status, body: await response.json() };
}
const createdSession = await call(a, { action: "create", preorderId: discussionFixtureScope().preorderId }, "", {}, "discussions");
assert.equal(createdSession.status, 200); const session = createdSession.body.session;
const sent = await call(a, { action: "send", sessionId: session.id, expectedVersion: 1, expectedContextHash: session.contextHash,
  requestKey: `slice5-http-${randomUUID()}`, message: "Pengingat unit 4 biaya 10000 untuk blueprint sintetis", preferences: { budgetCapIdr: 50000, allowDiscount: true, channels: ["whatsapp"] }, scenario: "normal" }, "", {}, "discussions");
assert.equal(sent.status, 200); assert.equal(sent.body.persisted, true);
const choices = await call(a, undefined, `?sessionId=${session.id}`);
assert.equal(choices.status, 200); assert.ok(choices.body.proposals[0].eligible);
const create = { action: "create", selection: choices.body.proposals[0].selection, campaignId: randomUUID(), requestId: randomUUID(), scenario: "valid" };
let passed = 0; async function test(name, work) { await work(); passed++; console.log(`PASS ${name}`); }
let current;
await test("blueprint authentication, origin, strict input, size and scope boundaries", async () => {
  assert.equal((await call(undefined)).status, 401);
  assert.equal((await call(b, undefined, `?sessionId=${session.id}`)).status, 404);
  assert.equal((await call(b, create)).status, 404);
  assert.equal((await call(a, undefined, "?campaignId=invalid")).status, 400);
  assert.equal((await call(a, create, "", { Origin: "https://untrusted.example" })).status, 403);
  assert.equal((await call(a, { ...create, proposal: sent.body.proposal })).status, 400);
  assert.equal((await call(a, { ...create, padding: "x".repeat(66000) })).status, 400);
  assert.equal((await call(a, undefined, `?campaignId=${randomUUID()}`)).status, 404);
});
await test("HTTP sourced atomic creation, replay and conflicting request ID", async () => {
  current = await call(a, create); assert.equal(current.status, 200);
  assert.equal(current.body.active.version, 1); assert.equal(current.body.active.approval_status, "proposed");
  assert.equal(current.body.campaign.status, "draft"); assert.equal(current.body.campaign.published_at, null);
  const replay = await call(a, create); assert.equal(replay.status, 200); assert.equal(replay.body.replayed, true);
  const conflict = await call(a, { ...create, scenario: "invalid" }); assert.equal(conflict.status, 409); assert.equal(conflict.body.code, "IDEMPOTENCY_CONFLICT");
  assert.equal((await call(b, undefined, `?campaignId=${create.campaignId}`)).status, 404);
});
function revision(view, scenario = "valid") {
  const body = view.active.blueprint_json;
  return { action: "revise", campaignId: view.campaign.id, requestId: randomUUID(), expectedCampaignVersion: view.campaign.version,
    expectedBlueprintId: view.active.id, expectedBlueprintVersion: view.active.version, scenario,
    edits: { title: body.campaignTitle, marketingApproach: "limited_discount", discountBps: 500, budgetCapIdr: 20000, targetAdditionalUnits: 6,
      startsAt: body.executionWindow.startsAt, endsAt: body.executionWindow.endsAt, channels: body.channels, notes: "Tambahkan pengingat akhir" } };
}
await test("HTTP provider failure, invalid output and invalid capacity preserve the saved version", async () => {
  const failure = await call(a, revision(current.body, "failure")); assert.equal(failure.status, 503); assert.equal(failure.body.code, "PROVIDER_UNAVAILABLE");
  const invalid = await call(a, revision(current.body, "invalid")); assert.equal(invalid.status, 502); assert.equal(invalid.body.code, "INVALID_BLUEPRINT");
  const bad = revision(current.body); bad.edits.targetAdditionalUnits = 41;
  const capacity = await call(a, bad); assert.equal(capacity.status, 400); assert.equal(capacity.body.code, "FINANCIAL_OR_CAPACITY_BLOCKER");
  const loaded = await call(a, undefined, `?campaignId=${create.campaignId}`); assert.equal(loaded.body.history.length, 1);
});
await test("HTTP revision, stale write rejection, explicit approval and refresh recovery", async () => {
  const command = revision(current.body); current = await call(a, command); assert.equal(current.status, 200);
  assert.equal(current.body.active.version, 2); assert.equal(current.body.active.blueprint_json.financial.calculation.hypotheticalFinalUnitPriceIdr, 114000);
  assert.equal((await call(a, { ...command, requestId: randomUUID() })).status, 409);
  assert.equal((await call(a, command)).body.replayed, true);
  const approval = { action: "approve", campaignId: create.campaignId, blueprintId: current.body.active.id, expectedBlueprintVersion: 2,
    expectedCampaignVersion: current.body.campaign.version, confirm: true };
  assert.equal((await call(a, { ...approval, confirm: false })).status, 400);
  assert.equal((await call(b, approval)).status, 404);
  assert.equal((await call(a, { ...approval, expectedBlueprintVersion: 1 })).status, 409);
  current = await call(a, approval); assert.equal(current.status, 200);
  assert.equal(current.body.active.approval_status, "approved"); assert.equal(current.body.active.approved_by_user_id, accounts[0].id);
  assert.equal(current.body.materialized.tasks.length, 3); assert.equal(current.body.materialized.contents.length, 1);
  assert.equal(current.body.campaign.status, "draft"); assert.equal(current.body.campaign.published_at, null);
  assert.equal((await call(a, approval)).body.replayed, true);
  const loaded = await call(a, undefined, `?campaignId=${create.campaignId}`); assert.equal(loaded.body.active.id, current.body.active.id);
  mkdirSync("node_modules/.cache/campaign-blueprint", { recursive: true });
  writeFileSync("node_modules/.cache/campaign-blueprint/example.json", JSON.stringify(loaded.body, null, 2));
});
await test("HTTP approval revalidates actual changed PostgreSQL facts without partial approval", async () => {
  const draft = await call(a, { ...create, campaignId: randomUUID(), requestId: randomUUID() }); assert.equal(draft.status, 200);
  const approval = { action: "approve", campaignId: draft.body.campaign.id, blueprintId: draft.body.active.id, expectedBlueprintVersion: 1,
    expectedCampaignVersion: draft.body.campaign.version, confirm: true };
  const product = discussionFixtureScope().productId;
  const db = (sql) => execFileSync("docker", ["exec", "supabase_db_campaign-lab", "psql", "-U", "postgres", "-d", "postgres", "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-c", sql], { encoding: "utf8", stdio: "pipe" }).trim();
  assert.equal(db(`SELECT base_price_idr FROM public.products WHERE id='${product}' AND sku LIKE 'S4-%';`), "120000");
  try {
    db(`UPDATE public.products SET base_price_idr=130000 WHERE id='${product}' AND base_price_idr=120000;`);
    const rejected = await call(a, approval); assert.equal(rejected.status, 409); assert.equal(rejected.body.code, "STALE_CONTEXT");
    const loaded = await call(a, undefined, `?campaignId=${draft.body.campaign.id}`);
    assert.equal(loaded.body.active.approval_status, "proposed"); assert.equal(loaded.body.materialized.tasks.length, 0); assert.equal(loaded.body.materialized.contents.length, 0);
  } finally { db(`UPDATE public.products SET base_price_idr=120000 WHERE id='${product}' AND base_price_idr=130000;`); }
});
console.log(`${passed} blueprint HTTP groups passed; local synthetic data only`);
