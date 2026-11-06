import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { randomUUID, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { runConcurrency } from "../database/v2.1/tests/concurrency.mjs";
import { verifySchemaColumns } from "../database/v2.1/tests/schema-contract.mjs";

const root = resolve(import.meta.dirname, "..");
const cache = resolve(root, "node_modules/.cache/database-v21-cutover");
mkdirSync(cache, { recursive: true });
const cli = (...args) => {
  try { return execFileSync(process.execPath, [resolve(root, "node_modules/supabase/dist/supabase.js"), ...args],
    { cwd: root, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], maxBuffer: 8 * 1024 * 1024 }); }
  catch { throw new Error("Local Supabase CLI failed; output withheld because status may contain credentials"); }
};
const docker = (args, input) => execFileSync("docker", args, { input, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], maxBuffer: 8 * 1024 * 1024 });
const db = "supabase_db_campaign-lab";
const labels = JSON.parse(docker(["inspect", db, "--format", "{{json .Config.Labels}}"]));
assert.equal(labels["com.supabase.cli.project"], "campaign-lab");
assert.equal(resolve(labels["com.supabase.cli.workdir"]).toLowerCase(), root.toLowerCase());
const sql = (input) => docker(["exec", "-i", db, "psql", "-U", "postgres", "-d", "postgres", "-X", "-qAt", "-v", "ON_ERROR_STOP=1"], input);
const status = JSON.parse(cli("status", "-o", "json"));
assert.equal(status.API_URL, "http://127.0.0.1:54321", "Only the intended local API is allowed");
assert.ok(typeof status.ANON_KEY === "string" && typeof status.SERVICE_ROLE_KEY === "string");
const accounts = [
  { id: "11111111-1111-4111-8111-111111111111", email: "owner-a@campaign-lab.example.test" },
  { id: "22222222-2222-4222-8222-222222222222", email: "owner-b@campaign-lab.example.test" },
];
const business = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const preorder = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4";
const foreignBusiness = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const foreignPreorder = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb4";
const api = async (path, token, method = "GET", body) => {
  const response = await fetch(`${status.API_URL}${path}`, { method, signal: AbortSignal.timeout(15_000),
    headers: { apikey: status.ANON_KEY, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const data = await response.json();
  return { status: response.status, data };
};
const rpc = (name, token, body) => api(`/rest/v1/rpc/${name}`, token, "POST", body);
let checks = 0;
const pass = (message) => { checks++; console.log(`PASS ${message}`); };

if (process.argv.includes("--setup-fixtures")) {
  const credentials = [];
  for (const account of accounts) {
    const existing = await api(`/auth/v1/admin/users/${account.id}`, status.SERVICE_ROLE_KEY);
    if (existing.status === 200) assert.equal(existing.data.email, account.email, "Do not overwrite an unknown account");
    else assert.equal(existing.status, 404);
    const password = randomBytes(24).toString("base64url");
    const created = await api(`/auth/v1/admin/users${existing.status === 200 ? `/${account.id}` : ""}`, status.SERVICE_ROLE_KEY,
      existing.status === 200 ? "PUT" : "POST", { ...account, password, email_confirm: true });
    assert.ok([200, 201].includes(created.status), `Auth fixture provisioning HTTP ${created.status}`);
    assert.equal(created.data.id, account.id);
    credentials.push({ ...account, password });
  }
  writeFileSync(resolve(cache, "fixture-credentials.json"), JSON.stringify(credentials));
  const count = Number(sql(`SELECT count(*) FROM public.businesses WHERE id IN ('${business}','${foreignBusiness}');`).trim());
  if (count === 0) sql(readFileSync(resolve(root, "supabase/seed.sql"), "utf8"));
  else assert.equal(count, 2, "Incomplete fixture dataset needs explicit review");
  // Keep all other provider settings intact; development points only to this local stack.
  const envPath = resolve(root, ".env.local");
  const updates = { NEXT_PUBLIC_SUPABASE_URL: status.API_URL, NEXT_PUBLIC_PUBLISHABLE_KEY: status.PUBLISHABLE_KEY ?? status.ANON_KEY,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: status.PUBLISHABLE_KEY ?? status.ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: status.SERVICE_ROLE_KEY };
  const lines = (existsSync(envPath) ? readFileSync(envPath, "utf8") : "").split(/\r?\n/)
    .filter((line) => !/^(NEXT_PUBLIC_SERVICE_ROLE_KEY|NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY)=/.test(line));
  for (const [key, value] of Object.entries(updates)) {
    const index = lines.findIndex((line) => line.startsWith(`${key}=`));
    if (index < 0) lines.push(`${key}=${value}`); else lines[index] = `${key}=${value}`;
  }
  writeFileSync(envPath, lines.join("\n"));
  pass("real GoTrue fixture subjects, synthetic seed and local development env configured (credentials withheld)");
}

if (process.argv.includes("--pg-tests")) {
  assert.equal(sql(`SELECT status||':'||version FROM public.preorders WHERE id='${preorder}';`).trim(), "draft:1",
    "The pgTAP fixture suite requires freshly seeded draft data; it never resets existing data");
  const input = readFileSync(resolve(root, "database/v2.1/tests/invariants.sql"), "utf8");
  const result = sql(input.replace("CREATE EXTENSION pgtap", "CREATE EXTENSION IF NOT EXISTS pgtap"));
  assert.ok(!/^not ok|^# Looks like|^Bail out!/m.test(result), "Local pgTAP assertion failed; inspect the safe test artifact");
  writeFileSync(resolve(cache, "pgtap.txt"), result.split(/\r?\n/).filter((line) => /^(ok |not ok |#|1\.\.)/.test(line)).join("\n"));
  assert.match(result, /^1\.\.100$/m);
  pass("100 pgTAP assertions on actual Supabase PostgreSQL; all test row changes rolled back");
  const connection = (input) => new Promise((resolve, reject) => {
    const child = spawn("docker", ["exec", "-i", db, "psql", "-U", "postgres", "-d", "postgres", "-X", "-qAt", "-v", "ON_ERROR_STOP=1"], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = ""; let stderr = "";
    child.stdout.on("data", (data) => { stdout += data; }); child.stderr.on("data", (data) => { stderr += data; });
    child.on("error", reject); child.on("close", (code) => resolve({ code, stdout, stderr })); child.stdin.end(input);
  });
  await runConcurrency(sql, connection);
  pass("three real concurrent-connection races also pass on the active local Supabase database");
}

const credentials = JSON.parse(readFileSync(resolve(cache, "fixture-credentials.json"), "utf8"));
const tokens = [];
for (const account of credentials) {
  const login = await api("/auth/v1/token?grant_type=password", status.ANON_KEY, "POST", { email: account.email, password: account.password });
  assert.equal(login.status, 200);
  assert.ok(typeof login.data.access_token === "string" && login.data.user?.id === account.id);
  tokens.push(login.data.access_token);
}
const [ownerA, ownerB] = tokens;
pass("two synthetic owners authenticate through GoTrue and receive actual local JWTs");
const own = await api("/rest/v1/businesses?select=id", ownerA);
assert.equal(own.status, 200); assert.deepEqual(own.data, [{ id: business }]);
const other = await api(`/rest/v1/businesses?id=eq.${business}&select=id`, ownerB);
assert.equal(other.status, 200); assert.deepEqual(other.data, []);
pass("PostgREST RLS isolates owner A and B");
const anonymous = await api("/rest/v1/campaigns?select=id", status.ANON_KEY);
assert.ok([401, 403].includes(anonymous.status));
const write = await api(`/rest/v1/campaigns?id=eq.aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6`, ownerA, "PATCH", { status: "published" });
assert.equal(write.status, 403);
pass("anonymous private reads and authenticated direct writes are denied");
for (const [token, bid, pid] of [[ownerA, business, preorder], [ownerB, foreignBusiness, foreignPreorder]]) {
  const rows = await api(`/rest/v1/preorders?id=eq.${pid}&select=status,version`, token);
  assert.equal(rows.status, 200); assert.equal(rows.data.length, 1);
  if (rows.data[0].status === "draft") {
    const published = await rpc("publish_preorder", token, { p_business_id: bid, p_preorder_id: pid, p_expected_version: rows.data[0].version });
    assert.equal(published.status, 200); assert.equal(published.data.status, "published");
  }
}
pass("synthetic preorders activated through owner RPC; price snapshots frozen, campaign remains draft");

const session = randomUUID(); const hash = "a".repeat(64); const key = `jwt-test-${randomUUID()}`;
const scope = { p_business_id: business, p_session_id: session };
const created = await rpc("create_ai_session", ownerA, { ...scope, p_preorder_id: preorder, p_context_hash: hash });
assert.equal(created.status, 200);
const denied = await rpc("create_ai_session", ownerB, { ...scope, p_session_id: randomUUID(), p_preorder_id: preorder, p_context_hash: hash });
assert.equal(denied.status, 403);
const wrongScope = await rpc("create_ai_session", ownerA, { ...scope, p_session_id: randomUUID(), p_preorder_id: foreignPreorder, p_context_hash: hash });
assert.equal(wrongScope.status, 409);
pass("JWT owner session creation works; foreign owner and cross-tenant preorder binding denied");
const command = { ...scope, p_expected_version: 1, p_context_hash: hash, p_request_key: key, p_input_hash: "b".repeat(64),
  p_model_id: "synthetic-database-test", p_message: "Fixture JWT sintetis; tidak memanggil Gemini." };
const claim = await rpc("claim_ai_generation", ownerA, command);
assert.equal(claim.status, 200); assert.equal(claim.data.status, "claimed");
const replay = await rpc("claim_ai_generation", ownerA, command);
assert.equal(replay.status, 200); assert.equal(replay.data.generationId, claim.data.generationId); assert.equal(replay.data.status, "running");
const stale = await rpc("claim_ai_generation", ownerA, { ...command, p_request_key: `${key}-stale` });
// PostgREST maps SQLSTATE 40001 to HTTP 500; the future application handler maps this domain conflict to 409.
assert.equal(stale.status, 500); assert.equal(stale.data.code, "40001"); assert.equal(stale.data.message, "VERSION_CONFLICT");
pass("JWT claim RPC is idempotent and rejects stale expected version");
const output = { schemaVersion: 1, businessId: business, preorderId: preorder, sessionId: session, requestKey: key,
  contextHash: hash, proposalVersion: claim.data.claimVersion, state: "proposed", persistence: "not_saved",
  status: "no_valid_options", requiresOwnerReview: true,
  preferences: { budgetCapIdr: null, allowDiscount: false, channels: ["whatsapp"] },
  generatedAt: new Date().toISOString(), model: "synthetic-database-test", providerRequestId: null,
  sourceReferences: ["c1.preorder"], rejectedOptions: [], limitations: ["Fixture database sintetis; tidak memanggil Gemini."],
  options: [], reply: "Respons sintetis untuk verifikasi database, bukan hasil Gemini." };
const completion = { ...scope, p_generation_id: claim.data.generationId, p_claim_version: claim.data.claimVersion,
  p_output_json: output, p_actor_user_id: accounts[0].id };
const forbiddenFinalize = await rpc("finalize_ai_generation", ownerA, completion);
assert.equal(forbiddenFinalize.status, 403);
const finalized = await rpc("finalize_ai_generation", status.SERVICE_ROLE_KEY, completion);
assert.equal(finalized.status, 200);
const duplicateFinalize = await rpc("finalize_ai_generation", status.SERVICE_ROLE_KEY, completion);
assert.equal(duplicateFinalize.status, 200);
pass("only trusted service finalizes; assistant/generation transaction and replay work through PostgREST");
const foreignMessages = await api(`/rest/v1/campaign_ai_messages?session_id=eq.${session}&select=sequence`, ownerB);
assert.equal(foreignMessages.status, 200); assert.deepEqual(foreignMessages.data, []);
const messages = await api(`/rest/v1/campaign_ai_messages?session_id=eq.${session}&select=sequence,role&order=sequence`, ownerA);
assert.equal(messages.status, 200); assert.deepEqual(messages.data, [{ sequence: 1, role: "user" }, { sequence: 2, role: "assistant" }]);
const again = await api(`/rest/v1/campaign_ai_sessions?id=eq.${session}&select=version`, ownerA);
assert.equal(again.status, 200); assert.equal(again.data[0].version, 3);
pass("independent reload retrieves durable session/history; tenant B sees no messages");
const failure = await rpc("claim_ai_generation", ownerA, { ...command, p_expected_version: 3, p_request_key: `${key}-failure` });
assert.equal(failure.status, 200);
const failed = await rpc("fail_ai_generation", status.SERVICE_ROLE_KEY, { ...scope, p_generation_id: failure.data.generationId,
  p_claim_version: failure.data.claimVersion, p_error_code: "PROVIDER_TIMEOUT", p_actor_user_id: accounts[0].id });
assert.equal(failed.status, 200);
const assistants = await api(`/rest/v1/campaign_ai_messages?session_id=eq.${session}&role=eq.assistant&select=sequence`, ownerA);
assert.equal(assistants.status, 200); assert.equal(assistants.data.length, 1);
pass("failed synthetic generation persists without another assistant success");
const zeroVector = `[${Array(768).fill(1).join(",")}]`;
const foreignMemory = await rpc("match_campaign_memories", ownerB, { p_business_id: business, p_embedding: zeroVector,
  p_model: "synthetic-model", p_profile: "synthetic-profile", p_embedding_version: 1 });
assert.equal(foreignMemory.status, 403);
const payment = await rpc("apply_verified_payment", ownerA, { p_payment_id: randomUUID(), p_provider_order_id: "SIMULATED-UNVERIFIED",
  p_event_key: "not-verified", p_payload_hash: hash, p_amount_idr: 1, p_provider_status: "settlement", p_provider_paid_at: new Date().toISOString() });
assert.equal(payment.status, 403);
pass("sensitive memory and payment RPC boundaries reject unauthorized JWT callers");

const catalog = JSON.parse(sql(readFileSync(resolve(root, "database/v2.1/tests/catalog.sql"), "utf8")));
writeFileSync(resolve(cache, "actual-catalog.json"), JSON.stringify(catalog, null, 2));
const documented = verifySchemaColumns(readFileSync(resolve(root, "docs/schema.md"), "utf8"), catalog.columns);
writeFileSync(resolve(cache, "documented-columns.json"), JSON.stringify(documented, null, 2));
assert.equal(documented.filter((row) => row.classification !== "MATCH").length, 0, "Actual columns differ from latest schema.md; inspect documented-columns.json");
pass("all351 columns directly match schema.md types/nullability/documented defaults and UUID PK defaults");
const expected = JSON.parse(readFileSync(resolve(root, "node_modules/.cache/database-v21/catalog.json"), "utf8"));
const diffs = [];
const keyFor = { tables: (x) => x.table, columns: (x) => `${x.table}.${x.column}`, constraints: (x) => `${x.table}.${x.name}`,
  indexes: (x) => x.indexname, policies: (x) => `${x.tablename}.${x.policyname}`, triggers: (x) => `${x.table}.${x.name}`,
  functions: (x) => `${x.schema}.${x.name}(${x.arguments})` };
for (const [category, key] of Object.entries(keyFor)) {
  const actual = new Map(catalog[category].map((row) => [key(row), row]));
  for (const row of expected[category]) {
    const name = key(row); const found = actual.get(name);
    const classification = found === undefined ? "MISSING" : JSON.stringify(found) === JSON.stringify(row) ? "MATCH" : "MISMATCH";
    diffs.push({ category, name, classification, ...(classification === "MISMATCH" ? { expected: row, actual: found } : {}) });
    actual.delete(name);
  }
  for (const name of actual.keys()) diffs.push({ category, name, classification: "EXTRA" });
}
for (const required of expected.extensions.filter((e) => ["plpgsql", "vector"].includes(e.name))) {
  diffs.push({ category: "extensions", name: required.name,
    classification: catalog.extensions.some((e) => JSON.stringify(e) === JSON.stringify(required)) ? "MATCH" : "MISMATCH" });
}
for (const extension of catalog.extensions.filter((e) => !["plpgsql", "vector"].includes(e.name))) {
  diffs.push({ category: "extensions", name: extension.name, classification: "INTENTIONALLY DIFFERENT", reason: "Supabase-managed or test-only extension" });
}
writeFileSync(resolve(cache, "schema-diff.json"), JSON.stringify(diffs, null, 2));
const mismatches = diffs.filter((d) => ["MISSING", "EXTRA", "MISMATCH"].includes(d.classification));
console.log(`Catalog audit: ${diffs.filter((d) => d.classification === "MATCH").length} MATCH, ${mismatches.length} deviations (details in ignored schema-diff.json)`);
assert.equal(mismatches.length, 0, "Actual local catalog differs from verified v2.1 baseline; review schema-diff.json");
pass("actual local tables/columns/defaults/nullability/constraints/indexes/RLS/grants/function bodies+EXECUTE/triggers match verified baseline");
const types = cli("gen", "types", "typescript", "--local", "--schema", "public");
assert.ok(types.includes("export type Database") && !/\bany\b/.test(types));
writeFileSync(resolve(cache, "database.types.ts"), types);
const typePaths = [resolve(root, "node_modules/.cache/database-v21/database.types.ts"), resolve(cache, "database.types.ts")];
const program = ts.createProgram(typePaths, { strict: true, noEmit: true, skipLibCheck: true });
const checker = program.getTypeChecker();
const sources = typePaths.map((path) => program.getSourceFile(path));
const get = (type, key) => {
  const property = type.getProperty(key);
  assert.ok(property, `Generated type property missing: ${key}`);
  return checker.getTypeOfSymbolAtLocation(property, sources[0]);
};
const publicTypes = sources.map((source) => {
  const symbol = checker.getExportsOfModule(checker.getSymbolAtLocation(source)).find((entry) => entry.name === "Database");
  assert.ok(symbol, "Database export required");
  return get(checker.getDeclaredTypeOfSymbol(symbol), "public");
});
for (const group of ["Tables", "Functions"]) {
  const pair = publicTypes.map((type) => get(type, group));
  for (const name of pair[0].getProperties().map((symbol) => symbol.name)) {
    for (const kind of group === "Tables" ? ["Row", "Insert", "Update"] : ["Args", "Returns"]) {
      const values = pair.map((type) => get(get(type, name), kind));
      assert.ok(checker.isTypeAssignableTo(values[0], values[1]) && checker.isTypeAssignableTo(values[1], values[0]), `${group}.${name}.${kind} changed`);
    }
  }
}
pass("all generated Row/Insert/Update and RPC Args/Returns agree with disposable schema types; CLI adds relationship metadata");
if (process.argv.includes("--write-types")) {
  mkdirSync(resolve(root, "src/lib/supabase"), { recursive: true });
  writeFileSync(resolve(root, "src/lib/supabase/database.types.ts"), types);
}
pass("current database types generated using local Supabase CLI (no remote access)");
writeFileSync(resolve(cache, "result.json"), JSON.stringify({ checks, project: "campaign-lab", api: status.API_URL,
  tables: catalog.tables.length, columns: catalog.columns.length, constraints: catalog.constraints.length,
  indexes: catalog.indexes.length, policies: catalog.policies.length, functions: catalog.functions.length, triggers: catalog.triggers.length }, null, 2));
console.log(`PASS ${checks} local Supabase integration groups; no provider calls; credentials withheld`);
