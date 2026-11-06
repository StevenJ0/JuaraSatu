// Requires the local Next development server and the documented synthetic GoTrue accounts.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
  assert.equal(login.user.id, account.id); assert.ok(typeof login.access_token === "string"); tokens.push(login.access_token);
}
const [ownerA, ownerB] = tokens;
const call = async (token, body, query = "", headers = {}) => {
  const response = await fetch(`${origin}/api/dev/discussions${query}`, { method: body ? "POST" : "GET",
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": "application/json", ...headers },
    ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: response.status, body: await response.json() };
};
let checks = 0;
async function test(name, work) { await work(); checks++; console.log(`PASS ${name}`); }
const created = await call(ownerA, { action: "create", preorderId: discussionFixtureScope().preorderId });
assert.equal(created.status, 200); const session = created.body.session;
const message = { action: "send", sessionId: session.id, expectedVersion: 1, expectedContextHash: session.contextHash,
  requestKey: randomUUID(), message: "Pengingat dari API sintetis", preferences: { budgetCapIdr: 50000, allowDiscount: true, channels: ["whatsapp"] }, scenario: "normal" };
await test("HTTP authentication, CSRF, malformed scope, size limit and inaccessible session status", async () => {
  assert.equal((await call(undefined)).status, 401);
  assert.equal((await call(ownerB, undefined, `?sessionId=${session.id}`)).status, 404);
  assert.equal((await call(ownerB, message)).status, 404);
  assert.equal((await call(ownerA, message, "", { Origin: "https://untrusted.example" })).status, 403);
  assert.equal((await call(ownerA, { ...message, message: "x".repeat(17000) })).status, 400);
  assert.equal((await call(ownerA, { ...message, ownerUserId: accounts[1].id })).status, 400);
  assert.equal((await call(ownerA, undefined, "?sessionId=invalid")).status, 400);
});
await test("HTTP persisted success, completed replay, conflicting duplicate and stale version mapping", async () => {
  const first = await call(ownerA, message); assert.equal(first.status, 200); assert.equal(first.body.persisted, true);
  assert.equal(first.body.proposal.persistence, "saved");
  const replay = await call(ownerA, message); assert.equal(replay.status, 200); assert.equal(replay.body.replayed, true);
  const conflict = await call(ownerA, { ...message, message: "Payload berbeda" });
  assert.equal(conflict.status, 409); assert.equal(conflict.body.code, "IDEMPOTENCY_CONFLICT");
  const stale = await call(ownerA, { ...message, requestKey: randomUUID() });
  assert.equal(stale.status, 409); assert.equal(stale.body.code, "VERSION_CONFLICT");
});
await test("HTTP recovery rejects a live turn, recovers an expired synthetic claim, and allows a new request", async () => {
  const fresh = await call(ownerA, { action: "create", preorderId: session.preorderId }); assert.equal(fresh.status, 200);
  const s = fresh.body.session;
  const response = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/claim_ai_generation`, { method: "POST",
    headers: { apikey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${ownerA}`, "Content-Type": "application/json" },
    body: JSON.stringify({ p_business_id: s.businessId, p_session_id: s.id, p_expected_version: 1, p_context_hash: s.contextHash,
      p_request_key: randomUUID(), p_input_hash: "b".repeat(64), p_model_id: "development-fake", p_message: "Synthetic interrupted request" }) });
  assert.equal(response.status, 200); const claim = await response.json();
  const recover = { action: "recover", sessionId: s.id, generationId: claim.generationId, expectedVersion: 2 };
  assert.equal((await call(ownerB, recover)).status, 404);
  const live = await call(ownerA, recover); assert.equal(live.status, 409); assert.equal(live.body.code, "TURN_IN_PROGRESS");
  assert.match(claim.generationId, /^[a-f0-9-]{36}$/); assert.match(s.id, /^[a-f0-9-]{36}$/);
  // Age only this known synthetic fixture to exercise the server deadline without waiting two minutes.
  execFileSync("docker", ["exec", "supabase_db_campaign-lab", "psql", "-U", "postgres", "-d", "postgres", "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-c",
    `UPDATE public.ai_generations SET started_at=clock_timestamp()-interval '3 minutes' WHERE id='${claim.generationId}' AND session_id='${s.id}' AND model_id='development-fake' AND status='running';`], { stdio: "pipe" });
  const recovered = await call(ownerA, recover); assert.equal(recovered.status, 200);
  assert.equal(recovered.body.session.generations[0].status, "failed"); assert.equal(recovered.body.session.messages.length, 1);
  const retry = await call(ownerA, { ...message, sessionId: s.id, expectedContextHash: s.contextHash, expectedVersion: 3, requestKey: randomUUID() });
  assert.equal(retry.status, 200); assert.equal(retry.body.persisted, true);
});
await test("actual catalog edit makes the context stale; explicit refresh retains frozen preorder pricing", async () => {
  const db = (query) => execFileSync("docker", ["exec", "supabase_db_campaign-lab", "psql", "-U", "postgres", "-d", "postgres", "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-c", query], { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
  const product = discussionFixtureScope().productId;
  const price = Number(db(`SELECT base_price_idr FROM public.products WHERE id='${product}' AND business_id='${session.businessId}' AND sku LIKE 'S4-%';`));
  assert.equal(price, 120000);
  const fresh = await call(ownerA, { action: "create", preorderId: session.preorderId }); assert.equal(fresh.status, 200); const s = fresh.body.session;
  try {
    db(`UPDATE public.products SET base_price_idr=130000 WHERE id='${product}' AND base_price_idr=120000;`);
    const stale = await call(ownerA, { ...message, sessionId: s.id, expectedContextHash: s.contextHash, requestKey: randomUUID() });
    assert.equal(stale.status, 409); assert.equal(stale.body.code, "STALE_CONTEXT");
    const refreshed = await call(ownerA, { action: "refresh", sessionId: s.id, expectedVersion: 3 }); assert.equal(refreshed.status, 200);
    const generated = await call(ownerA, { ...message, sessionId: s.id, expectedContextHash: refreshed.body.session.contextHash,
      expectedVersion: refreshed.body.session.version, requestKey: randomUUID() });
    assert.equal(generated.status, 200); assert.equal(generated.body.proposal.options[0].computedScenario.hypotheticalFinalUnitPriceIdr, 120000);
  } finally { db(`UPDATE public.products SET base_price_idr=120000 WHERE id='${product}' AND base_price_idr=130000;`); }
});
console.log(`${checks} actual Next HTTP boundary checks passed; no secret output or external provider calls`);
