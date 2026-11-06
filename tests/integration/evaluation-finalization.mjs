import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { randomUUID, randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { call, fixtureTokens, localFixtureSettings, createCampaignFixture, closeFixtureCampaign } from "../fixtures/local-campaign.mjs";
import { createEvaluationFixture, generateEvaluationCommand } from "../fixtures/local-evaluation.mjs";

const container = "supabase_db_campaign-lab";
const business = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1", owner = "11111111-1111-4111-8111-111111111111";
const docker = (args, input) => execFileSync("docker", args, { input, encoding: "utf8", windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
assert.equal(docker(["inspect", container, "--format", '{{index .Config.Labels "com.supabase.cli.project"}}']).trim(), "campaign-lab");
const args = ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "-X", "-qAt", "-v", "ON_ERROR_STOP=1"];
const quote = (value) => value === null ? "NULL" : `'${String(value).replaceAll("'", "''")}'`;
const json = (value) => `${quote(JSON.stringify(value))}::jsonb`;
const sql = (query) => docker(args, query).trim();
const claims = "SET LOCAL ROLE service_role; SELECT set_config('request.jwt.claims','{\"role\":\"service_role\"}',true);";
function connection(query, name, hold = false) {
  const child = spawn("docker", args, { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "", stderr = ""; let ready;
  const barrier = new Promise((resolve) => { ready = resolve; });
  const finished = new Promise((resolve, reject) => {
    child.on("error", reject); child.stdout.on("data", (data) => { stdout += data; if (stdout.includes("SLICE7B_READY")) ready(); });
    child.stderr.on("data", (data) => { stderr += data; });
    child.on("close", (code) => { ready(); resolve({ code, stdout, stderr }); });
  });
  const initial = `BEGIN; SET LOCAL application_name=${quote(name)}; ${claims} ${query};`;
  if (hold) child.stdin.write(`${initial} SELECT 'SLICE7B_READY';\n`); else child.stdin.end(`${initial} COMMIT;\n`);
  return { barrier, finished, release: () => child.stdin.end("COMMIT;\n"), kill: () => child.kill() };
}
const pause = () => new Promise((resolve) => setTimeout(resolve, 30));
let races = 0;
async function race(first, second, expectedSecondCode) {
  const label = `slice7b-${randomUUID().slice(0, 8)}`; const held = connection(first, `${label}-a`, true); let other;
  try {
    await held.barrier;
    other = connection(second, `${label}-b`);
    const deadline = Date.now() + 10000; let blocked = false;
    while (Date.now() < deadline) {
      blocked = sql(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=${quote(`${label}-b`)} AND wait_event_type='Lock');`) === "t";
      if (blocked) break; await pause();
    }
    assert.ok(blocked, "The second real PostgreSQL connection must be observed waiting on a lock");
    held.release(); const [a, b] = await Promise.all([held.finished, other.finished]);
    assert.equal(a.code, 0, a.stderr);
    if (expectedSecondCode === null) assert.equal(b.code, 0, b.stderr);
    else { assert.notEqual(b.code, 0, "Conflicting second transaction must abort"); assert.ok(b.stderr.includes(expectedSecondCode), b.stderr); }
    races++;
  } finally { held.kill(); other?.kill(); }
}
const [tokenA, tokenB] = await fixtureTokens();
const read = async (id, scenario = "exceeds_target") => { const r = await call(tokenA, "evaluations", undefined, `?campaignId=${id}&scenario=${scenario}`); assert.equal(r.status, 200, r.body.code); return r.body; };
let groups = 0;
async function test(name, work) { await work(); groups++; console.log(`PASS ${name}`); }
async function setup(review = true, scenario = "exceeds_target", withExpense = true) {
  const f = await createEvaluationFixture(tokenA, withExpense); let current = await read(f.campaignId, scenario);
  const generated = await call(tokenA, "evaluations", generateEvaluationCommand(current, scenario)); assert.equal(generated.status, 200, generated.body.code); current = generated.body;
  if (review) {
    const reviewed = await call(tokenA, "evaluations", { action: "review", campaignId: f.campaignId, requestId: randomUUID(), evaluationId: current.latestEvaluationId,
      expectedCampaignVersion: current.context.snapshot.campaign.version, expectedContextHash: current.context.contextHash, confirm: true });
    assert.equal(reviewed.status, 200, reviewed.body.code); current = reviewed.body;
  }
  return { ...f, current, row: current.history[0].row };
}
function finalSql(f, overrides = {}) {
  const command = { business, campaign: f.campaignId, preorder: f.current.context.snapshot.preorder.id, evaluation: f.row.id, request: randomUUID(),
    version: f.current.context.snapshot.campaign.version, hash: f.current.context.contextHash, mode: "development_synthetic", actor: owner, ...overrides };
  return `SELECT public.finalize_campaign_evaluation(${[command.business, command.campaign, command.preorder, command.evaluation, command.request, command.version, command.hash, command.mode, command.actor].map(quote).join(",")})`;
}
function saveSql(f, review = false, id = randomUUID()) {
  const metrics = { ...f.row.metrics_json, commandHash: randomBytes(32).toString("hex"), parentEvaluationId: review ? f.row.id : null };
  const analysis = { ...f.row.analysis_json, review: review ? { status: "reviewed", reviewedByUserId: owner, reviewedAt: new Date().toISOString() }
    : { status: "unreviewed", reviewedByUserId: null, reviewedAt: null } };
  return `SELECT public.record_campaign_evaluation_cas(${[business, f.campaignId, f.row.blueprint_id, id, f.row.id].map(quote).join(",")},${json(metrics)},${json(analysis)},${json(f.row.limitations_json)},${quote(f.row.calculated_at)},${quote(owner)})`;
}
function legacySql(f, id = randomUUID()) {
  return `SELECT public.record_campaign_evaluation(${[business,f.campaignId,f.row.blueprint_id,id,"provisional"].map(quote).join(",")},'{}','{}','[]',clock_timestamp(),${quote(owner)})`;
}
async function reject(query, code) { const result = await connection(query, `slice7b-reject-${randomUUID().slice(0, 6)}`).finished; assert.notEqual(result.code, 0); assert.ok(result.stderr.includes(code), result.stderr); }
function costInsert(f) { return `INSERT INTO public.campaign_costs(id,business_id,campaign_id,category,description,amount_idr,incurred_at) VALUES(${quote(randomUUID())},${quote(business)},${quote(f.campaignId)},'other','Slice7B race expense synthetic',1,clock_timestamp())`; }

await test("missing/unreviewed evaluation and invalid lifecycle reject without partial completion", async () => {
  const empty = await createEvaluationFixture(tokenA); const current = await read(empty.campaignId);
  const f = { ...empty, current, row: { id: randomUUID() } };
  await reject(finalSql(f), "EVALUATION_REQUIRED");
  const unreviewed = await setup(false); await reject(finalSql(unreviewed), "OWNER_REVIEW_REQUIRED");
  await reject(`UPDATE public.campaigns SET status='completed',completed_at=clock_timestamp() WHERE id=${quote(unreviewed.campaignId)}`, "ATOMIC_FINALIZATION_REQUIRED");
  assert.equal((await read(unreviewed.campaignId)).context.snapshot.campaign.status, "closed");
  const scopes = JSON.parse(readFileSync("node_modules/.cache/campaign-evaluation/preorders.json", "utf8"));
  const live = await createCampaignFixture(tokenA, { scopeOverride: scopes[0] });
  try {
    const id = live.command.campaignId; const preorder = sql(`SELECT preorder_id FROM public.campaigns WHERE id=${quote(id)}`);
    await reject(finalSql(unreviewed, { campaign: id, preorder }), "CLOSED_CAMPAIGN_REQUIRED");
    assert.equal((await call(tokenA, "campaigns", live.command)).status, 200);
    await reject(finalSql(unreviewed, { campaign: id, preorder }), "CLOSED_CAMPAIGN_REQUIRED");
  } finally { await closeFixtureCampaign(tokenA, live.command.campaignId); }
});
await test("stale campaign/evaluation versions and wrong owner scope are rejected by SQL", async () => {
  const f = await setup(); await reject(finalSql(f, { version: f.current.context.snapshot.campaign.version - 1 }), "STALE_SOURCE_STATE");
  await reject(finalSql(f, { actor: "22222222-2222-4222-8222-222222222222" }), "FORBIDDEN");
  await connection(saveSql(f), "slice7b-newer").finished.then((r) => assert.equal(r.code, 0, r.stderr));
  await reject(finalSql(f), "STALE_EVALUATION_VERSION");
});
await test("unknown KPI, unavailable production C6 and synthetic mode mismatch fail closed", async () => {
  const f = await setup(true, "missing_cost"); await reject(finalSql(f), "KPI_INCOMPLETE");
  const valid = await setup(); await reject(finalSql(valid, { mode: "verified" }), "VERIFIED_C6_UNAVAILABLE");
  const unknownCosts = await setup(true, "exceeds_target", false); await reject(finalSql(unknownCosts), "COSTS_INCOMPLETE");
  assert.equal((await read(valid.campaignId)).context.snapshot.campaign.status, "closed");
});
await test("phantom cost INSERT wins first: stale evaluation CAS and finalization both abort", async () => {
  const f = await setup(); await race(costInsert(f), saveSql(f), "STALE_SOURCE_STATE");
  await reject(finalSql(f), "STALE_SOURCE_STATE"); assert.equal((await read(f.campaignId)).history.length, 2);
  const unreviewed = await setup(false); await race(costInsert(unreviewed), saveSql(unreviewed, true), "STALE_SOURCE_STATE");
  assert.equal((await read(unreviewed.campaignId)).history.length, 1);
});
await test("cost void wins first: finalization waits and rejects inconsistent financial facts", async () => {
  const f = await setup(); const cost = f.current.context.costs[0];
  await race(`UPDATE public.campaign_costs SET voided_at=clock_timestamp(),void_reason='Synthetic concurrent correction' WHERE id=${quote(cost.id)}`, finalSql(f), "STALE_SOURCE_STATE");
  assert.equal((await read(f.campaignId)).context.costsCompleteness, "unreviewed");
});
await test("checklist update wins first: finalization and evaluation review reject stale execution facts", async () => {
  const f = await setup(); const task = f.current.context.snapshot.tasks.find((t) => !t.completed_at);
  await race(`UPDATE public.campaign_tasks SET completed_at=clock_timestamp() WHERE id=${quote(task.id)}`, finalSql(f), "STALE_SOURCE_STATE");
  const g = await setup(false); const other = g.current.context.snapshot.tasks.find((t) => !t.completed_at);
  await race(`UPDATE public.campaign_tasks SET completed_at=clock_timestamp() WHERE id=${quote(other.id)}`, saveSql(g, true), "STALE_SOURCE_STATE");
});
await test("concurrent review snapshots CAS the same parent: exactly one new immutable child", async () => {
  const f = await setup(false); await race(saveSql(f, true), saveSql(f, true), "STALE_EVALUATION_VERSION");
  const current = await read(f.campaignId); assert.equal(current.history.length, 2); assert.equal(current.history.find((e) => e.row.id === f.row.id).row.analysis_json.review.status, "unreviewed");
});
await test("a concurrent latest review invalidates finalization using its former source token", async () => {
  const f = await setup(false); await race(saveSql(f, true), finalSql(f), "STALE_EVALUATION_VERSION");
  assert.equal((await read(f.campaignId)).context.snapshot.campaign.status, "closed");
});
await test("legacy evaluation writers participate in locking and invalidate the latest finalization token", async () => {
  const f = await setup(); const id = randomUUID(); await race(legacySql(f, id), finalSql(f), "STALE_EVALUATION_VERSION");
  const current = await read(f.campaignId); assert.equal(current.latestEvaluationId, id); assert.equal(current.unsupportedCount, 1);
  assert.equal(current.finalization.eligible, false); assert.equal(current.context.snapshot.campaign.status, "closed");
});
await test("transaction rollback removes both completion and final evaluation", async () => {
  const f = await setup(); const id = randomUUID(); await reject(`${finalSql(f, { request: id })}; SELECT 1/0`, "division by zero");
  const current = await read(f.campaignId); assert.equal(current.context.snapshot.campaign.status, "closed"); assert.equal(current.history.length, 2);
  assert.equal(sql(`SELECT count(*) FROM public.campaign_evaluations WHERE id=${quote(id)}`), "0");
});
await test("finalization wins first: queued phantom cost/checklist writes abort after completion", async () => {
  const f = await setup(); await race(finalSql(f), costInsert(f), "COMPLETED_CAMPAIGN_IMMUTABLE");
  assert.equal((await read(f.campaignId)).context.costs.length, 1);
  const g = await setup(); const task = g.current.context.snapshot.tasks[0];
  await race(finalSql(g), `UPDATE public.campaign_tasks SET completed_at=NULL WHERE id=${quote(task.id)}`, "COMPLETED_CAMPAIGN_IMMUTABLE");
});
await test("concurrent different finalization requests have one winner; identical durable request replays", async () => {
  const f = await setup(); const request = randomUUID(); const query = finalSql(f, { request });
  await race(query, finalSql(f), "CLOSED_CAMPAIGN_REQUIRED");
  const replay = await connection(query, "slice7b-replay").finished; assert.equal(replay.code, 0, replay.stderr);
  await reject(finalSql(f, { request, hash: "0".repeat(64) }), "IDEMPOTENCY_CONFLICT");
  const current = await read(f.campaignId); assert.equal(current.context.snapshot.campaign.status, "completed"); assert.equal(current.history.length, 3);
  const final = current.history[0]; assert.equal(final.row.id, request); assert.equal(final.row.evaluation_kind, "final"); assert.equal(final.stale, false);
  assert.equal(final.row.metrics_json.finalization.mode, "development_synthetic"); assert.equal(final.row.metrics_json.context.analytics.data.isProvisional, true);
  assert.ok(final.memoryExclusions.includes("SYNTHETIC_EVALUATION")); assert.equal(current.finalization.productionEligible, false);
  for (const query of [costInsert(f), `UPDATE public.campaign_costs SET amount_idr=2 WHERE campaign_id=${quote(f.campaignId)}`,
    `UPDATE public.campaign_tasks SET completed_at=NULL WHERE campaign_id=${quote(f.campaignId)}`,
    `UPDATE public.campaign_contents SET body='changed' WHERE campaign_id=${quote(f.campaignId)}`,
    `UPDATE public.campaigns SET costs_completeness='unreviewed' WHERE id=${quote(f.campaignId)}`]) await reject(query, "COMPLETED_CAMPAIGN_IMMUTABLE");
  await reject(saveSql(f), "CLOSED_CAMPAIGN_REQUIRED");
  await reject(legacySql(f), "COMPLETED_CAMPAIGN_IMMUTABLE");
  await reject(`UPDATE public.campaigns SET status='completed' WHERE id=${quote(f.campaignId)}`, "COMPLETED_CAMPAIGN_IMMUTABLE");
  assert.equal(sql(`SELECT count(*) FROM public.campaign_memories WHERE campaign_id=${quote(f.campaignId)}`), "0");
  // Negative insert must abort before creating a memory or queueing an indexing job.
  await reject(`INSERT INTO public.campaign_memories(id,business_id,campaign_id,source_evaluation_id,source_version,summary_text,lessons_json,limitations_json,content_hash,review_status,embedding_status)
    VALUES(${quote(randomUUID())},${quote(business)},${quote(f.campaignId)},${quote(request)},1,'Rejected synthetic approval probe','{}','[]',${quote("a".repeat(64))},'approved','queued')`, "SYNTHETIC_MEMORY_APPROVAL_FORBIDDEN");
  assert.equal(sql(`SELECT count(*) FROM public.campaign_memories WHERE campaign_id=${quote(f.campaignId)}`), "0");
  mkdirSync("node_modules/.cache/campaign-evaluation", { recursive: true });
  writeFileSync("node_modules/.cache/campaign-evaluation/finalized-example.json", JSON.stringify(current, null, 2));
});
await test("concurrent identical finalization requests replay the same durable completion", async () => {
  const f = await setup(); const query = finalSql(f); await race(query, query, null);
  const current = await read(f.campaignId); assert.equal(current.history.length, 3); assert.equal(current.context.snapshot.campaign.status, "completed");
});
await test("real owner JWTs cannot execute privileged RPCs or finalize another tenant", async () => {
  const f = await setup(); const command = { action: "finalize", campaignId: f.campaignId, requestId: randomUUID(), evaluationId: f.row.id,
    expectedCampaignVersion: f.current.context.snapshot.campaign.version, expectedContextHash: f.current.context.contextHash, confirm: true };
  assert.equal((await call(tokenB, "evaluations", command)).status, 404); assert.equal((await call(undefined, "evaluations", command)).status, 401);
  for (const role of ["anon", "authenticated"]) for (const name of ["record_campaign_evaluation_cas", "finalize_campaign_evaluation"]) {
    assert.equal(sql(`SELECT has_function_privilege(${quote(role)},p.oid,'EXECUTE') FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname=${quote(name)}`), "f");
  }
  const { env } = localFixtureSettings();
  const rpcArgs = { finalize_campaign_evaluation: { p_business_id: business, p_campaign_id: f.campaignId, p_preorder_id: f.current.context.snapshot.preorder.id,
    p_evaluation_id: f.row.id, p_request_id: randomUUID(), p_expected_campaign_version: f.current.context.snapshot.campaign.version,
    p_expected_context_hash: f.current.context.contextHash, p_mode: "development_synthetic", p_actor_user_id: owner },
  record_campaign_evaluation_cas: { p_business_id: business, p_campaign_id: f.campaignId, p_blueprint_id: f.row.blueprint_id, p_evaluation_id: randomUUID(),
    p_expected_evaluation_id: f.row.id, p_metrics: f.row.metrics_json, p_analysis: f.row.analysis_json, p_limitations: f.row.limitations_json,
    p_calculated_at: f.row.calculated_at, p_actor_user_id: owner } };
  for (const token of [null, tokenA, tokenB]) for (const [name, body] of Object.entries(rpcArgs)) {
    const response = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/${name}`, { method: "POST", headers: {
      apikey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
    assert.ok([401, 403].includes(response.status)); assert.equal((await response.json()).code, "42501");
  }
  assert.equal((await read(f.campaignId)).context.snapshot.campaign.status, "closed");
});
console.log(`${groups} Slice7B PostgreSQL/HTTP groups passed; ${races} observed two-connection lock races; no orders/payments/memory created`);
