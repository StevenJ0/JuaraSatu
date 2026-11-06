import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync, existsSync, openSync, closeSync, fsyncSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { Script, createContext } from "node:vm";
import { pathToFileURL } from "node:url";

const campaignId = "c8f2a641-9b73-4e02-a7d5-61c90b38f254", origin = "http://localhost:3000";
const directory = "node_modules/.cache/business-memory-e2e";

const authorizationId = "2abb12ae-8fc6-4a40-bfd0-5707f782dcc0";
const liveJournalPath = directory + "/live-" + authorizationId + ".json";
export function verifyLiveSafety(env, evidence, expectedLast4) {
  if (env.CAMPAIGN_MEMORY_PROVIDER !== "gemini" || env.CAMPAIGN_MEMORY_RETRIEVAL !== "gemini" ||
    env.GEMINI_MODEL !== "gemini-3.6-flash" || env.GEMINI_DEBUG !== "true") return "REAL_PROVIDER_CONFIGURATION_CHANGED";
  if (evidence?.projectName !== "Tugas Akhir" || evidence?.billingTier !== "Free tier" || evidence?.billingAction !== "Set up billing" ||
    evidence?.modelFreeTierConfirmed !== true) return "FREE_TIER_EVIDENCE_MISSING";
  if (!evidence?.projectId || typeof expectedLast4 !== "string" || expectedLast4.length !== 4 || !env.GEMINI_API_KEY?.endsWith(expectedLast4)) return "KEY_PROJECT_MATCH_UNVERIFIED";
  return null;
}
export function reserveLiveAttempt(path, command, source, evidence) {
  assert.equal(command.action, "generate"); assert.equal(command.scenario, "valid"); assert.equal(command.campaignId, campaignId);
  assert.equal(source.synthetic, true); assert.equal(source.productionEligible, false); assert.equal(source.developmentEligible, true);
  assert.equal(command.evaluationId, source.evaluationId); assert.equal(command.expectedContextHash, source.contextHash);
  const fields = ["action", "campaignId", "evaluationId", "expectedContextHash", "requestId", "scenario"];
  assert(Object.keys(command).length === fields.length && Object.keys(command).every(key => fields.includes(key)), "UNEXPECTED_GENERATION_FIELD");
  const body = structuredClone(command);
  const entry = { authorizationId, consumedBeforeDispatch: true, consumedAt: new Date().toISOString(), command: body, requestBodyJson: JSON.stringify(body),
    sourceVersion: source.sourceVersion, safety: { projectName: evidence.projectName, projectId: evidence.projectId, billingTier: evidence.billingTier,
      billingAction: evidence.billingAction, modelFreeTierConfirmed: true, keySuffixMatched: true, keyProjectVerification: "user-supplied project identity and suffix; not programmatic key lookup" } };
  const fd = openSync(path, "wx");
  try { writeFileSync(fd, JSON.stringify(entry, null, 2) + "\n"); fsyncSync(fd); } finally { closeSync(fd); }
  return entry;
}
function syntheticDraftsOnly(snapshot) {
  return snapshot.memories.every(row => row.reviewStatus === "draft" && row.synthetic === true && row.productionEligible === false);
}
export function decodeGeminiEvents(text) {
  return text.split("\n").filter(line => line.includes("[GEMINI_DEBUG]")).flatMap(line => {
    try {
      let value = JSON.parse(line);
      if (typeof value.message === "string") value = JSON.parse(value.message.slice(value.message.indexOf("[GEMINI_DEBUG]") + "[GEMINI_DEBUG]".length).trim());
      if (typeof value === "string") value = JSON.parse(value);
      return value && typeof value.stage === "string" ? [value] : [];
    } catch { return []; }
  });
}

export function interpolate(text, variables) {
  return String(text).replace(/\{\{([^{}]+)\}\}/g, (literal, key) => key === "$randomUUID" ? randomUUID() : variables.has(key) ? String(variables.get(key)) : literal);
}
// Default remains no inference. A separate opt-in and durable journal permit one authorized generation.
export function noInferencePolicy(method, body, snapshot) {
  if (method === "GET") return null;
  if (body?.action === "generate") return ["failure", "invalid", "missing_evidence"].includes(body.scenario) && snapshot.memories.length === 0
    ? null : "LIVE_MEMORY_GENERATION_NOT_AUTHORIZED_AND_BILLING_UNVERIFIED";
  if (body?.action === "run_worker") return snapshot.jobs.length === 0 && syntheticDraftsOnly(snapshot) ? null : "WORKER_MAY_INVOKE_EMBEDDING";
  if (body?.action === "retrieve") return syntheticDraftsOnly(snapshot) ? null : "RETRIEVAL_REQUIRES_ELIGIBILITY_PREFLIGHT";
  return "PERSISTED_MEMORY_CANDIDATE_REQUIRED";
}
export function executeScript(code, context, label) {
  if (code?.trim()) new Script("(function(){\n" + code + "\n})()", { filename: label }).runInContext(context, { timeout: 3000 });
}
async function main() {
  execFileSync(process.execPath, ["scripts/validate-bruno-collection.mjs"], { stdio: "inherit", windowsHide: true });
  const parsed = JSON.parse(readFileSync("node_modules/.cache/bruno-audit/parsed.json", "utf8"));
  const env = Object.fromEntries(readFileSync(".env.local", "utf8").split(/\r?\n/).filter(l => /^[A-Z_]+=/.test(l)).map(l => {
    const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).replace(/^["']|["']$/g, "")];
  }));
  assert.equal(env.NEXT_PUBLIC_SUPABASE_URL, "http://127.0.0.1:54321");
  assert.equal(env.CAMPAIGN_MEMORY_PROVIDER, "gemini"); assert.equal(env.CAMPAIGN_MEMORY_RETRIEVAL, "gemini");
  function sql(query) {
    return JSON.parse(execFileSync("docker", ["exec", "-i", "supabase_db_campaign-lab", "psql", "-U", "postgres", "-d", "postgres", "-X", "-qAt", "-v", "ON_ERROR_STOP=1"],
      { input: query, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim());
  }
  const owner = sql("SELECT jsonb_build_object('id',u.id,'email',u.email,'businessId',m.business_id) FROM auth.users u JOIN public.business_members m ON m.user_id=u.id JOIN public.campaigns c ON c.business_id=m.business_id WHERE c.id='" + campaignId + "' AND m.role='owner' LIMIT 1;");
  const snapshotQuery = "SELECT jsonb_build_object('campaign',(SELECT jsonb_build_object('id',id,'status',status,'version',version,'baselineHash',md5(baseline_json::text)) FROM public.campaigns WHERE id='" + campaignId + "'),'evaluations',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'kind',evaluation_kind,'provider',analysis_json->>'provider','status',analysis_json->>'status','review',analysis_json#>>'{review,status}','hash',md5(to_jsonb(e)::text)) ORDER BY created_at DESC,id DESC),'[]'::jsonb) FROM public.campaign_evaluations e WHERE campaign_id='" + campaignId + "'),'memories',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'hash',md5(to_jsonb(m)::text),'businessId',business_id,'campaignId',campaign_id,'evaluationId',source_evaluation_id,'sourceVersion',source_version,'provider',lessons_json->>'provider','reviewStatus',review_status,'embeddingStatus',embedding_status,'decision',lessons_json#>>'{ownerReview,decision}','synthetic',lessons_json#>'{source,synthetic}','productionEligible',lessons_json#>'{source,productionEligible}','contentHash',content_hash) ORDER BY id),'[]'::jsonb) FROM public.campaign_memories m WHERE business_id='" + owner.businessId + "'),'jobs',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'hash',md5(to_jsonb(j)::text)) ORDER BY id),'[]'::jsonb) FROM public.job_runs j WHERE business_id='" + owner.businessId + "'),'otherMemoryDigest',(SELECT md5(coalesce(string_agg(md5(to_jsonb(x)::text),'' ORDER BY id),'')) FROM public.campaign_memories x WHERE business_id<>'" + owner.businessId + "'));";
  const before = sql(snapshotQuery);
  const liveMode = process.argv.includes("--live-memory-once");
  const evidencePath = directory + "/free-tier-evidence.json";
  const safetyEvidence = existsSync(evidencePath) ? JSON.parse(readFileSync(evidencePath, "utf8")) : null;
  const safetyReason = verifyLiveSafety(env, safetyEvidence, process.env.MEMORY_EXPECTED_KEY_LAST4);
  let journal = existsSync(liveJournalPath) ? JSON.parse(readFileSync(liveJournalPath, "utf8")) : null;
  let liveEvidence = null;
  const transitions = [];
  assert.equal(before.campaign.status, "completed"); assert.equal(before.evaluations[0].kind, "final");
  assert.equal(before.evaluations[0].status, "available"); assert.equal(before.evaluations[0].review, "reviewed");
  async function authenticate(identity) {
    const headers = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY, "Content-Type": "application/json" };
    const generated = await fetch(env.NEXT_PUBLIC_SUPABASE_URL + "/auth/v1/admin/generate_link", { method: "POST", headers, body: JSON.stringify({ type: "magiclink", email: identity.email }), signal: AbortSignal.timeout(10000) });
    assert.equal(generated.status, 200, "LOCAL_OWNER_LINK_FAILED"); const link = await generated.json();
    const verified = await fetch(env.NEXT_PUBLIC_SUPABASE_URL + "/auth/v1/verify", { method: "POST", headers: { apikey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ type: "magiclink", token_hash: link.hashed_token ?? link.properties?.hashed_token }), signal: AbortSignal.timeout(10000) });
    assert.equal(verified.status, 200, "LOCAL_OWNER_AUTH_FAILED"); const session = await verified.json(); assert.equal(session.user.id, identity.id); return session.access_token;
  }
  const token = await authenticate(owner), variables = new Map(parsed.env.variables.map(v => [v.name, v.value]));
  for (const [key, value] of Object.entries({ baseUrl: origin, campaignId, confirmFakeProviders: "false", confirmRealGemini: "true",
    allowAuth: "true", allowNegative: "true", allowMutations: "true", allowLifecycle: "true" })) variables.set(key, value);
  for (const key of ["memoryId","memoryHash","memoryBody","sourceEvaluationId","memorySourceHash","requestId"]) variables.delete(key);
  const results = [], extraChecks = [];
  const logPath = ".next/dev/logs/next-development.log";
  const providerCount = () => readFileSync(logPath, "utf8").split("\n").filter(l => l.includes("SDK_REQUEST") && l.includes("STARTED")).length;
  const starts = providerCount();
  function assertIntegrity(current) {
    for (const key of ["campaign", "evaluations", "jobs", "otherMemoryDigest"]) assert.deepEqual(current[key], before[key], "SOURCE_OR_UNRELATED_STATE_CHANGED");
    if (!liveMode || !journal) { assert.deepEqual(current.memories, before.memories); return; }
    assert(current.memories.every(m => m.id === journal.command.requestId && m.businessId === owner.businessId &&
      m.campaignId === campaignId && m.evaluationId === journal.command.evaluationId && m.sourceVersion === journal.sourceVersion &&
      m.provider === "gemini" && m.reviewStatus === "draft" && m.embeddingStatus === "queued" && m.synthetic === true && m.productionEligible === false),
      "UNEXPECTED_MEMORY_STATE");
    assert(current.memories.length <= 1);
  }
  async function localCall(method, url, body, credentials = token) {
    const target = new URL(url); assert.equal(target.origin, origin); assert.equal(target.pathname, "/api/dev/memories");
    const response = await fetch(target, { method, headers: { ...(credentials ? { Authorization: "Bearer " + credentials } : {}), Origin: origin, "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), redirect: "manual", signal: AbortSignal.timeout(90000) });
    return { status: response.status, value: await response.json() };
  }
  const requests = parsed.requests.filter(r => r.path.startsWith("07-Business-Memory/")).sort((a, b) => Number(a.meta.seq) - Number(b.meta.seq));
  assert.equal(requests.length, 16);
  let source = null;
  for (const request of requests) {
    const number = Number(request.meta.seq), assertions = [], started = performance.now();
    let body = request.body?.[request.http.body], response = null;
    const method = request.http.method.toUpperCase();
    // Permit collection's cost guard only for actions independently proven not to invoke a provider.
    variables.set("allowPaidRequests", [3, 4, 5, 14, 15].includes(number) || liveMode && [6, 7].includes(number) ? "true" : "false");
    const req = { getMethod: () => method, getUrl: () => request.http.url, getBody: () => body, setBody: value => { body = value; } };
    const bru = { getVar: key => variables.get(key), setVar: (key, value) => variables.set(key, value), interpolate: value => interpolate(value, variables) };
    const context = createContext({ bru, req, test: (name, work) => { work(); assertions.push({ name, passed: true }); } });
    try {
      executeScript(parsed.collection.script.req, context, "collection-pre");
      executeScript(request.script?.req, context, request.path + " pre");
      if (method !== "GET") body = typeof body === "string" ? JSON.parse(interpolate(body, variables)) : body;
      const current = sql(snapshotQuery);
      let reason = noInferencePolicy(method, body, current);
      const candidate = journal && current.memories.find(m => m.id === journal.command.requestId);
      if (liveMode && number === 6) {
        if (journal) {
          body = journal.command;
          variables.set("memoryBody", journal.requestBodyJson); variables.set("requestId", body.requestId);
          if (candidate) { variables.set("memoryId", candidate.id); variables.set("memoryHash", candidate.contentHash); reason = null; }
          else reason = "LIVE_ALLOWANCE_CONSUMED_NO_PERSISTED_CANDIDATE";
        } else reason = safetyReason;
      }
      if (liveMode && number === 7) reason = candidate && JSON.stringify(body) === journal.requestBodyJson ? null : "PERSISTED_LIVE_CANDIDATE_REQUIRED_FOR_REPLAY";
      if (liveMode && [9, 10, 11, 13].includes(number)) reason = candidate && candidate.campaignId === campaignId &&
        candidate.evaluationId === source?.evaluationId && candidate.synthetic === true && candidate.productionEligible === false &&
        candidate.reviewStatus === "draft" && body.memoryId === candidate.id && body.expectedContentHash === candidate.contentHash
        ? null : "CURRENT_OWNED_SYNTHETIC_CANDIDATE_REQUIRED";
      if (liveMode && number >= 3 && number <= 5 && current.memories.length) reason = "CANONICAL_CANDIDATE_EXISTS_INJECTION_CASE_NOT_EXECUTABLE";
      if (reason) { results.push({ test: number, file: request.path, result: "BLOCKED", http: null, reason }); continue; }
      const url = interpolate(request.http.url, variables); assert(!url.includes("{{"), "UNRESOLVED_URL");
      if (body !== undefined) assert(!JSON.stringify(body).includes("{{"), "UNRESOLVED_BODY");
      const logOffset = readFileSync(logPath, "utf8").length;
      if (liveMode && number === 6 && !journal) {
        assert.equal(providerCount(), starts, "CONCURRENT_PROVIDER_REQUEST");
        assert.equal(current.memories.length, 0); assert.equal(current.jobs.length, 0);
        assert(source && source.results.synthetic && source.results.provisional && source.developmentEligible && !source.productionEligible);
        mkdirSync(directory, { recursive: true });
        journal = reserveLiveAttempt(liveJournalPath, body, source, safetyEvidence);
        body = journal.command; variables.set("memoryBody", journal.requestBodyJson);
      }
      const sendingAt = performance.now();
      if (liveMode && number === 6 && candidate) response = await localCall("GET", origin + "/api/dev/memories?memoryId=" + candidate.id);
      else response = await localCall(method, url, method === "GET" ? undefined : body);
      if (liveMode && number === 6) {
        const events = decodeGeminiEvents(readFileSync(logPath, "utf8").slice(logOffset));
        const startsNow = events.filter(e => e.stage === "SDK_REQUEST" && e.result === "STARTED");
        liveEvidence = { attemptedThisRun: !candidate, requestId: body.requestId, sdkRequests: startsNow.length,
          httpStatus: response.status, latencyMs: Math.round((performance.now() - sendingAt) * 100) / 100,
          events: events.map(e => ({ traceId: e.requestId, stage: e.stage, result: e.result, code: e.code ?? null,
            httpStatus: e.httpStatus ?? null, transportPhase: e.transportPhase ?? null, elapsedMs: e.elapsedMs,
            interactionStatus: e.response?.interactionStatus ?? null, generatedJson: e.response?.generatedJson ?? null })) };
        if (!candidate) { journal.outcome = liveEvidence; writeFileSync(liveJournalPath, JSON.stringify(journal, null, 2) + "\n"); }
        if (!candidate) assert.equal(startsNow.length, 1, "EXACTLY_ONE_SDK_INVOCATION_REQUIRED");
      }
      context.res = { getStatus: () => response.status, getBody: () => response.value };
      executeScript(parsed.collection.script.res, context, "collection-post");
      executeScript(request.script?.res, context, request.path + " post");
      executeScript(request.tests, context, request.path + " assertions");
      if (number === 1) assert(response.value.campaigns.some(c => c.id === campaignId));
      if (number === 2) {
        source = response.value.source;
        assert.equal(source.evaluationId, before.evaluations[0].id); assert.equal(source.sourceVersion, before.campaign.version);
        assert.equal(source.businessId, owner.businessId); assert.equal(source.synthetic, true); assert.equal(source.productionEligible, false);
        assert.equal(source.results.provisional, true); assert(source.limitations.length > 0);
      }
      if (liveMode && [6, 7, 8, 9, 10, 11, 12, 16].includes(number)) {
        const row = response.value.row;
        assert.equal(row.id, journal.command.requestId); assert.equal(row.business_id, owner.businessId);
        assert.equal(row.source_evaluation_id, source.evaluationId); assert.equal(row.source_version, source.sourceVersion);
        assert.equal(row.review_status, "draft"); assert.equal(row.embedding_status, "queued"); assert.equal(response.value.indexing.job, null);
        assert.equal(row.lessons_json.generation.requestId, journal.command.requestId);
        assert.equal(row.lessons_json.source.contextHash, source.contextHash);
        assert(row.lessons_json.generatedAt); assert(row.lessons_json.providerRequestId === null || typeof row.lessons_json.providerRequestId === "string");
        assert.equal(row.lessons_json.provider, "gemini"); assert.equal(row.lessons_json.model, env.GEMINI_MODEL);
        assert.equal(row.lessons_json.source.synthetic, true); assert.equal(row.lessons_json.source.productionEligible, false);
        if ([9, 10, 11].includes(number)) {
          const audit = row.lessons_json.ownerReview;
          assert.equal(audit.ownerUserId, owner.id); assert.equal(audit.requestId, body.requestId);
          assert.equal(audit.expectedContentHash, body.expectedContentHash); assert.equal(audit.decision, body.decision);
          assert(audit.reviewedAt); assert.notEqual(row.content_hash, body.expectedContentHash);
          transitions.push({ test: number, memoryId: row.id, decision: audit.decision, requestId: audit.requestId,
            reviewedAt: audit.reviewedAt, actorMatchesOwner: true, previousHash: audit.expectedContentHash, contentHash: row.content_hash });
        }
      }
      assertIntegrity(sql(snapshotQuery));
      assert.equal(providerCount(), starts + (liveEvidence?.sdkRequests ?? 0), "UNEXPECTED_PROVIDER_START");
      results.push({ test: number, file: request.path, result: "PASS", http: response.status, code: response.value.code ?? null,
        durationMs: Math.round((performance.now() - started) * 100) / 100, assertions });
    } catch (error) {
      if (liveMode && number === 6 && journal && !liveEvidence) {
        liveEvidence = { attemptedThisRun: true, requestId: journal.command.requestId, sdkRequests: providerCount() - starts, httpStatus: null, ambiguous: true };
        journal.outcome = liveEvidence; writeFileSync(liveJournalPath, JSON.stringify(journal, null, 2) + "\n");
      }
      const message = error instanceof Error ? error.message : String(error);
      const blocked = !response && /OPT_IN_REQUIRED|PREREQUISITE_REQUIRED|EEXIST/.test(message);
      results.push({ test: number, file: request.path, result: blocked ? "BLOCKED" : "FAIL", http: response?.status ?? null,
        code: response?.value.code ?? null, reason: blocked && number === 6 ? "LIVE_MEMORY_NOT_AUTHORIZED_AND_BILLING_UNVERIFIED" : message,
        durationMs: Math.round((performance.now() - started) * 100) / 100 });
    }
  }
  const other = sql("SELECT jsonb_build_object('id',u.id,'email',u.email) FROM auth.users u JOIN public.business_members m ON m.user_id=u.id WHERE m.role='owner' AND m.business_id<>'" + owner.businessId + "' LIMIT 1;");
  const foreign = await authenticate(other);
  async function extra(name, method, query, body, credentials, expectedStatus, expectedCode) {
    const result = await localCall(method, origin + "/api/dev/memories" + query, body, credentials);
    assert.equal(result.status, expectedStatus, name); if (expectedCode) assert.equal(result.value.code, expectedCode, name);
    extraChecks.push({ name, http: result.status, code: result.value.code ?? null, result: "PASS" });
  }
  await extra("Unauthenticated source", "GET", "?campaignId=" + campaignId, undefined, "", 401);
  await extra("Foreign owner source", "GET", "?campaignId=" + campaignId, undefined, foreign, 404);
  if (source) {
    const command = { action: "generate", campaignId, evaluationId: source.evaluationId, requestId: randomUUID(), expectedContextHash: source.contextHash, scenario: "valid" };
    await extra("Foreign owner generation denied before inference", "POST", "", command, foreign, 404);
    await extra("Stale source hash denied before inference", "POST", "", { ...command, expectedContextHash: "0".repeat(64) }, token, 409, "STALE_MEMORY_SOURCE");
    await extra("Body cannot override business scope", "POST", "", { action: "run_worker", businessId: owner.businessId }, token, 400, "INVALID_INPUT");
    const old = before.evaluations.find(e => e.status === "failed");
    if (old) await extra("Historical failed Evaluation is not a current source", "POST", "", { ...command, evaluationId: old.id }, token, 409, "STALE_MEMORY_SOURCE");
  }
  const after = sql(snapshotQuery); assertIntegrity(after); assert.equal(providerCount(), starts + (liveEvidence?.sdkRequests ?? 0));
  const summary = { PASS: results.filter(r => r.result === "PASS").length, FAIL: results.filter(r => r.result === "FAIL").length, BLOCKED: results.filter(r => r.result === "BLOCKED").length };
  const output = { runId: randomUUID(), executedAt: new Date().toISOString(), harness: "Installed native Bruno parser + Node VM scripts + real local HTTP; not Bruno CLI",
    campaignId, finalEvaluationId: before.evaluations[0].id, source: source ? { evaluationId: source.evaluationId, sourceVersion: source.sourceVersion, contextHash: source.contextHash,
      synthetic: source.synthetic, productionEligible: source.productionEligible, developmentEligible: source.developmentEligible, provisional: source.results.provisional } : null,
    providers: { generation: env.CAMPAIGN_MEMORY_PROVIDER, embedding: env.CAMPAIGN_MEMORY_RETRIEVAL, realGenerationCalls: liveEvidence?.sdkRequests ?? 0, realEmbeddingCalls: 0, sdkStartDelta: providerCount() - starts },
    summary, results, extraChecks, before, after, liveMode, safetyReason, liveEvidence, transitions };
  mkdirSync(directory, { recursive: true });
  writeFileSync(directory + "/run-" + output.runId + ".json", JSON.stringify(output, null, 2) + "\n");
  writeFileSync(directory + "/latest.json", JSON.stringify(output, null, 2) + "\n");
  console.log(JSON.stringify({ summary, extraChecks: extraChecks.length, finalEvaluationId: output.finalEvaluationId, realProviderCalls: liveEvidence?.sdkRequests ?? 0, results: results.map(r => ({ test: r.test, result: r.result, http: r.http, code: r.code, reason: r.reason })) }));
  if (summary.FAIL) process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
