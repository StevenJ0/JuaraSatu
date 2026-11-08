import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { runMemoryTransactions } from "./memory-transactions.mjs";
import { runMemoryPipeline } from "./memory-pipeline.mjs";
import { verifyMigrationInventory } from "./migration-contract.mjs";

export async function runDatabaseContracts({ fullChain = false, strictDocs = false, generateTypes } = {}) {
// This test creates its own labelled, networkless container; it never accepts a database URL or existing container.
const root = resolve(import.meta.dirname, "../../..");
const image = "public.ecr.aws/supabase/postgres:17.11.0.006";
const runId = randomUUID();
const name = `campaign-lab-a1-${runId}`;
const migration = "20261107090000_generic_job_acknowledgement_guards.sql";
const a3 = process.argv.includes("--a3") || fullChain;
const a2 = process.argv.includes("--a2") || a3;
const claimMigration = "20261107100000_job_claim_isolation.sql";
const publicationMigration = "20261107110000_canonical_preorder_publication.sql";
const memoryTransactions = "20261104093000_memory_approval_and_indexing_transactions.sql";
const business = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const campaign = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6";
const blueprint = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa9";
const owner = "11111111-1111-4111-8111-111111111111";
const service = "SET ROLE service_role; SET request.jwt.claim.role='service_role';";
let container;
let engine;
let groups = 0;
let races = 0;
const applied = [];
const started = Date.now();

const dockerArgs = args => engine ? ["--host", engine, ...args] : args;
const docker = (args, input) => execFileSync("docker", dockerArgs(args), {
  input, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], maxBuffer: 10 * 1024 * 1024,
});
const read = path => readFileSync(resolve(root, path), "utf8");
const migrationSql = file => {
  const source = read(`supabase/migrations/${file}`);
  // Older SQL files without an outer transaction still apply atomically in this test harness.
  return /^BEGIN;/m.test(source) ? source : `BEGIN;\n${source}\nCOMMIT;`;
};
const apply = file => { sql(migrationSql(file)); applied.push(file); };
const sqlArgs = () => ["exec", "-i", container, "psql", "-h", "/tmp", "-U", "postgres", "-d", "postgres",
  "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose"];
const sql = query => docker(sqlArgs(), query).trim();
const json = query => JSON.parse(sql(query));
const literal = value => `'${value.replaceAll("'", "''")}'`;
const invoke = expression => json(`${service} SELECT json_build_object('result',${expression});`).result;
const complete = (id, attempt = 1, reference = null) => `public.complete_job('${id}',${attempt},${reference === null ? "NULL" : literal(reference)})`;
const fail = (id, attempt = 1, code = "EMAIL_UNAVAILABLE", reference = null) =>
  `public.fail_job('${id}',${attempt},${literal(code)},${reference === null ? "NULL" : literal(reference)})`;
const row = id => json(`SELECT to_jsonb(j) FROM public.job_runs j WHERE id='${id}';`);
const memoryRow = id => json(`SELECT to_jsonb(m) FROM public.campaign_memories m WHERE id='${id}';`);
const refuse = (query, pattern) => assert.throws(() => sql(query), pattern);
const pass = title => console.log(`PASS A1 ${++groups}: ${title}`);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

function connection(query) {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", dockerArgs(sqlArgs()), { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", value => { stdout += value; });
    child.stderr.on("data", value => { stderr += value; });
    child.on("error", reject);
    child.on("close", code => resolve({ code, stdout, stderr }));
    child.stdin.end(query);
  });
}

async function waitFor(query) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (sql(query) === "t") return;
    await pause(30);
  }
  throw Error("PostgreSQL lock barrier was not observed");
}

async function race(first, second, holdSeconds = 2) {
  const tag = `a1-${randomUUID()}`;
  const a = connection(`BEGIN; SET LOCAL statement_timeout='20s'; SET LOCAL application_name='${tag}-a'; ${first} SELECT pg_sleep(${holdSeconds}); COMMIT;`);
  await waitFor(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='${tag}-a' AND wait_event='PgSleep');`);
  const b = connection(`BEGIN; SET LOCAL statement_timeout='20s'; SET LOCAL application_name='${tag}-b'; ${second} COMMIT;`);
  await waitFor(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='${tag}-b' AND wait_event_type='Lock');`);
  const outcomes = await Promise.all([a, b]);
  for (const result of outcomes) assert.equal(result.code, 0, result.stderr);
  races++;
  return outcomes.map(result => JSON.parse(result.stdout.split(/\r?\n/).find(line => line.startsWith("{"))));
}

function fixtureJob(type = "send_paid_email", status = "running", attempt = 1, lease = "60 seconds") {
  const id = randomUUID();
  sql(`INSERT INTO public.job_runs(id,job_type,business_id,dedupe_key,status,attempt_count,next_run_at,locked_until)
    VALUES('${id}','${type}','${business}','${id}','${status}',${attempt},clock_timestamp(),
      ${status === "running" ? `clock_timestamp()+interval '${lease}'` : "NULL"});`);
  return id;
}

function claim(type) {
  const jobs = invoke(`public.claim_jobs(ARRAY['${type}']::text[],100,60)`);
  assert.ok(Array.isArray(jobs));
  return jobs;
}

function retire(id) {
  // Only this fixture's row is retired so later claim tests cannot pick up an expired test job.
  sql(`UPDATE public.job_runs SET status='dead',locked_until=NULL,finished_at=clock_timestamp() WHERE id='${id}';`);
}

function memoryFixture() {
  const evaluation = randomUUID(), memory = randomUUID(), hash = "a".repeat(64);
  // Reuse the existing 8B private plumbing fixture pattern; public synthetic approval remains forbidden.
  const job = sql(`SET request.jwt.claim.role='service_role';
    SELECT public.record_campaign_evaluation('${business}','${campaign}','${blueprint}','${evaluation}','final',
      '{"synthetic":true,"test_only":true,"is_sandbox_data":true}',NULL,'["A1 disposable lower-layer fixture only"]',clock_timestamp(),'${owner}');
    INSERT INTO public.campaign_memories(id,business_id,campaign_id,source_evaluation_id,source_blueprint_id,source_version,
      summary_text,lessons_json,limitations_json,content_hash,review_status,embedding_status,embedding_version)
    VALUES('${memory}','${business}','${campaign}','${evaluation}','${blueprint}',1,'A1 SYNTHETIC TEST ONLY',
      '{"test_only":true,"source":{"synthetic":true,"productionEligible":false},"ownerReview":{"decision":"reviewed","ownerUserId":"${owner}","requestId":"${randomUUID()}","reviewedAt":"2026-11-07T00:00:00Z"}}',
      '["Not production-eligible Memory"]','${hash}','draft','queued',1);
    SELECT private.approve_memory_and_enqueue('${business}','${memory}','${hash}','a1-no-provider-model','a1-isolated-lower-layer-768','${owner}');`)
    .split(/\r?\n/).at(-1);
  assert.match(job, /^[a-f0-9-]{36}$/);
  sql(`UPDATE public.job_runs SET status='running',attempt_count=1,locked_until=clock_timestamp()+interval '60 seconds' WHERE id='${job}';`);
  return { job, memory };
}

function functions() {
  return json(`SELECT json_agg(json_build_object('id',p.oid::regprocedure::text,'name',p.proname,
    'body',md5(pg_get_functiondef(p.oid)),'owner',pg_get_userbyid(p.proowner),'acl',p.proacl::text,
    'definer',p.prosecdef,'config',p.proconfig) ORDER BY p.oid)
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','private') AND p.prokind='f';`);
}

try {
  engine = JSON.parse(docker(["context", "inspect", "--format", "{{json .Endpoints.docker.Host}}"]));
  assert.ok(typeof engine === "string" && /^(?:npipe:\/{4}\.\/pipe\/[A-Za-z0-9_.-]+|unix:\/\/\/\S+)$/.test(engine), "Only a local Docker socket is allowed");
  docker(["image", "inspect", image]);
  container = docker(["run", "--rm", "--detach", "--network", "none", "--name", name,
    "--label", `campaign_lab.disposable=a1-${runId}`, "--user", "postgres", "--entrypoint", "/bin/sh", image, "-c",
    `initdb -D /tmp/campaign-a1 --auth=trust --no-locale > /tmp/init.log && exec postgres -D /tmp/campaign-a1 -k /tmp -c listen_addresses='${generateTypes ? "127.0.0.1" : ""}' -c fsync=off`,
  ]).trim();
  assert.match(container, /^[a-f0-9]{64}$/);
  const [identity] = JSON.parse(docker(["inspect", container]));
  assert.equal(identity.Id, container);
  assert.equal(identity.Config.Labels["campaign_lab.disposable"], `a1-${runId}`);
  assert.equal(identity.HostConfig.NetworkMode, "none");
  assert.deepEqual(identity.Mounts, []);
  assert.ok(!identity.HostConfig.PortBindings || Object.keys(identity.HostConfig.PortBindings).length === 0);
  let ready = false;
  for (let attempt = 0; attempt < 200; attempt++) {
    try { docker(["exec", container, "pg_isready", "-h", "/tmp", "-U", "postgres"]); ready = true; break; }
    catch { await pause(100); }
  }
  assert.ok(ready, "Fresh isolated PostgreSQL did not start");
  const target = json(`SELECT json_build_object('database',current_database(),'user',current_user,
    'directory',current_setting('data_directory'),'address',inet_server_addr(),
    'tables',(SELECT count(*) FROM pg_tables WHERE schemaname IN ('public','auth','storage')));`);
  assert.deepEqual(target, { database: "postgres", user: "postgres", directory: "/tmp/campaign-a1", address: null, tables: 0 });
  console.log(`PREFLIGHT ${name}: fresh PostgreSQL, Unix socket /tmp, no network/ports/mounts/history; label verified`);

  const migrations = readdirSync(resolve(root, "supabase/migrations")).filter(file => file.endsWith(".sql")).sort();
  if (fullChain) verifyMigrationInventory(migrations);
  assert.ok(migrations.includes(migration));
  if (a2) {
    assert.equal(migrations.filter(file => file <= (a3 ? publicationMigration : claimMigration)).at(-1), a3 ? publicationMigration : claimMigration);
    assert.equal(migrations.filter(file => file <= (a3 ? publicationMigration : claimMigration)).length, a3 ? 13 : 12);
  }
  assert.equal(new Set(migrations.map(file => file.split("_")[0])).size, migrations.length);

  sql(read("database/v2.1/tests/bootstrap.sql"));
  if (!fullChain) sql(read("database/v2.1/tests/platform-storage-v1.sql"));
  for (const file of migrations.filter(file => file < memoryTransactions)) apply(file);
  sql(read("supabase/seed.sql"));
  // Preserve legacy assertions at their original schema checkpoint, exactly as the existing disposable harness does.
  const invariants = read("database/v2.1/tests/invariants.sql");
  assert.match(invariants, /ROLLBACK;\s*$/);
  const legacy = sql(invariants.replace(/ROLLBACK;\s*$/, "COMMIT;"));
  assert.doesNotMatch(legacy, /^not ok|^# Looks like|^Bail out!/m);
  assert.match(legacy, /^1\.\.\d+$/m);
  assert.match(legacy, /^ok 65 - owner approval queues durable memory job$/m);
  console.log(`PASS legacy checkpoint pgTAP ${legacy.match(/^1\.\.(\d+)$/m)[1]} assertions; isolated retained fixture, unchanged source`);
  if (fullChain) {
    console.log("CHECKPOINT through 20261104092000: assertion #65 PASS under legacy approval contract; hardened approval tested later");
    await runMemoryPipeline(sql, connection);
  }
  for (const file of migrations.filter(file => file >= memoryTransactions && file < migration)) {
    if (fullChain && file === "20261106160000_core_preorder_on_v21.sql") {
      assert.throws(() => sql(migrationSql(file)), /storage[\s\S]*(does not exist|not exist)/);
      assert.equal(sql("SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='businesses' AND column_name='categories');"), "f");
      console.log("REPRODUCED PM09: core migration needs Storage; failed migration transaction left no categories column");
      sql(read("database/v2.1/tests/platform-storage-v1.sql"));
    }
    apply(file);
  }

  for (const operation of [complete, fail]) {
    const f = memoryFixture(), before = memoryRow(f.memory);
    assert.equal(invoke(operation(f.job)), operation === complete ? true : "retryable_failed");
    assert.deepEqual(memoryRow(f.memory), before);
    assert.equal(before.embedding, null);
    retire(f.job);
  }
  const expiredBefore = fixtureJob("expire", "running", 1, "-1 second");
  assert.equal(invoke(complete(expiredBefore)), true);
  console.log("REPRODUCED before A1: generic complete/fail mutate Memory jobs without vector; expired generic ACK succeeds");

  const beforeFunctions = functions();
  apply(migration);
  const afterFunctions = functions();
  assert.equal(afterFunctions.length, beforeFunctions.length);
  let replaced = 0;
  for (const before of beforeFunctions) {
    const after = afterFunctions.find(item => item.id === before.id);
    assert.ok(after);
    if (["complete_job", "fail_job"].includes(before.name)) {
      assert.notEqual(after.body, before.body);
      assert.deepEqual({ ...after, body: before.body }, before);
      assert.equal(after.definer, true);
      assert.deepEqual(after.config, ['search_path=""']);
      replaced++;
    } else assert.deepEqual(after, before);
  }
  assert.equal(replaced, 2);
  pass("all 11 migration files applied; exactly two function bodies changed, signatures/owners/ACLs and all claim/Memory functions preserved");

  if (a2) {
    const { runJobClaimIsolation } = await import("./job-claim-isolation.mjs");
    await runJobClaimIsolation({ sql, json, invoke, connection, waitFor, fixtureJob, memoryFixture, row, retire, functions,
      migrationSql: migrationSql(claimMigration), service, business,
      afterMigration: async () => {
        applied.push(claimMigration);
        if (!a3) return;
        const { runPreorderPublication } = await import("./preorder-publication.mjs");
        await runPreorderPublication({ sql, json, connection, waitFor, functions, root, runId,
          migrationSql: migrationSql(publicationMigration),
          afterMigration: fullChain ? async () => {
            applied.push(publicationMigration);
            const financialMigration = "20261108090000_financial_bounds_owner_cas.sql";
            const { runFinancialCas } = await import("./financial-cas.mjs");
            await runFinancialCas({ sql, json, functions, migrationSql: migrationSql(financialMigration) });
            applied.push(financialMigration);
          } : undefined });
        if (!fullChain) applied.push(publicationMigration);
      } });
  }

  for (const operation of [complete, fail]) {
    for (const [status, attempt] of [["running", 1], ["queued", 1], ["retryable_failed", 1], ["succeeded", 1], ["dead", 1], ["running", 5]]) {
      const f = memoryFixture();
      sql(`UPDATE public.job_runs SET status='${status}',attempt_count=${attempt},
        locked_until=CASE WHEN '${status}'='running' THEN locked_until END WHERE id='${f.job}';`);
      const jobBefore = row(f.job), memoryBefore = memoryRow(f.memory);
      refuse(`${service} SELECT ${operation(f.job, attempt)};`, /23514[\s\S]*ATOMIC_MEMORY_INDEXING_REQUIRED/);
      assert.deepEqual(row(f.job), jobBefore);
      assert.deepEqual(memoryRow(f.memory), memoryBefore);
      retire(f.job);
    }
    pass(`${operation === complete ? "complete_job" : "fail_job"} rejects Memory in five states and at exhaustion; complete job/Memory row snapshots unchanged`);
  }

  for (const type of ["send_paid_email", "expire", "reconcile"]) {
    const id = fixtureJob(type, "queued", 0);
    const claimed = claim(type).find(job => job.id === id);
    assert.ok(claimed);
    assert.equal(claimed.attempt_count, 1);
    assert.equal(invoke(complete(id, 1, "provider-test-only")), true);
    const done = row(id);
    assert.equal(done.status, "succeeded");
    assert.equal(done.provider_reference, "provider-test-only");
    assert.ok(done.finished_at);
    assert.equal(done.locked_until, null);
    assert.equal(invoke(complete(id)), false);
    assert.equal(invoke(fail(id)), null);
    assert.deepEqual(row(id), done);
    pass(`${type}: actual typed claim and completion work; duplicate/contradictory ACK is a non-mutating refusal`);
  }

  const email = fixtureJob("send_paid_email", "queued", 0);
  for (let attempt = 1; attempt <= 5; attempt++) {
    assert.equal(claim("send_paid_email").find(job => job.id === email)?.attempt_count, attempt);
    assert.equal(invoke(fail(email, attempt, "EMAIL_UNAVAILABLE", "mail-test-reference")), attempt === 5 ? "dead" : "retryable_failed");
    const failed = row(email);
    assert.equal(failed.attempt_count, attempt);
    assert.equal(failed.provider_reference, "mail-test-reference");
    assert.equal(failed.locked_until, null);
    if (attempt < 5) {
      const delay = Number(sql(`SELECT extract(epoch FROM next_run_at-clock_timestamp()) FROM public.job_runs WHERE id='${email}';`));
      assert.ok(delay > [60, 300, 900, 3600][attempt - 1] - 5 && delay <= [60, 300, 900, 3600][attempt - 1]);
      assert.equal(failed.finished_at, null);
    } else assert.ok(failed.finished_at);
    assert.equal(invoke(fail(email, attempt)), null);
    assert.equal(invoke(complete(email, attempt)), false);
    assert.deepEqual(row(email), failed);
    if (attempt < 5) sql(`UPDATE public.job_runs SET next_run_at=clock_timestamp()-interval '1 second' WHERE id='${email}';`);
  }
  assert.ok(!claim("send_paid_email").some(job => job.id === email));
  pass("email failure keeps 1/5/15/60 minute retries, attempt fencing and fifth-attempt exhaustion; no email sent");

  for (const type of ["expire", "reconcile"]) {
    const id = fixtureJob(type);
    assert.equal(invoke(fail(id)), "retryable_failed");
    assert.equal(row(id).status, "retryable_failed");
    retire(id);
  }
  pass("expiration/reconciliation failure remains retryable");

  for (const operation of [complete, fail]) {
    const id = fixtureJob("expire", "running", 1, "-1 second"), before = row(id);
    assert.equal(invoke(operation(id)), operation === complete ? false : null);
    assert.deepEqual(row(id), before);
    const reclaimed = claim("expire").find(job => job.id === id);
    assert.equal(reclaimed?.attempt_count, 2);
    const current = row(id);
    assert.equal(invoke(complete(id, 1)), false);
    assert.equal(invoke(fail(id, 1)), null);
    assert.equal(invoke(complete(id, "NULL")), false);
    assert.equal(invoke(fail(id, "NULL")), null);
    assert.deepEqual(row(id), current);
    assert.equal(invoke(complete(id, 2)), true);
  }
  pass("expired ACK refused before reclaim; new attempt succeeds, old/null attempt cannot mutate current claim");

  const idle = fixtureJob("expire", "queued", 0), idleBefore = row(idle);
  assert.equal(invoke(complete(idle, 0)), false);
  assert.equal(invoke(fail(idle, 0)), null);
  assert.deepEqual(row(idle), idleBefore);
  retire(idle);
  assert.equal(invoke(complete(randomUUID())), false);
  assert.equal(invoke(fail(randomUUID())), null);
  const invalid = fixtureJob(), invalidBefore = row(invalid);
  for (const code of ["", "buyer@example.test", "lowercase", "X".repeat(65)]) refuse(`${service} SELECT ${fail(invalid, 1, code)};`, /VALIDATION_ERROR/);
  assert.deepEqual(row(invalid), invalidBefore);
  retire(invalid);
  pass("missing/unclaimed jobs safely refused; invalid error codes keep existing validation and unchanged state");

  const rollback = fixtureJob(), rollbackBefore = row(rollback);
  sql(`BEGIN; ${service} SELECT ${complete(rollback)}; ROLLBACK;`);
  assert.deepEqual(row(rollback), rollbackBefore);
  retire(rollback);
  pass("transaction rollback leaves generic completion unchanged");

  for (const role of ["anon", "authenticated"]) {
    const id = fixtureJob(), before = row(id);
    for (const operation of [complete, fail]) refuse(`SET ROLE ${role}; SELECT ${operation(id)};`, /42501[\s\S]*permission denied/);
    assert.deepEqual(row(id), before);
    retire(id);
  }
  assert.equal(sql("SELECT relrowsecurity FROM pg_class WHERE oid='public.job_runs'::regclass;"), "t");
  pass("anon/authenticated cannot acknowledge; original EXECUTE grants and job RLS remain intact");

  for (const firstOperation of [complete, fail]) {
    const id = fixtureJob(), unrelated = fixtureJob(), unrelatedBefore = row(unrelated);
    const results = await race(`${service} SELECT json_build_object('result',${firstOperation(id)});`,
      `${service} SELECT json_build_object('complete',${complete(id)},'fail',${fail(id)});`);
    assert.equal(results[0].result, firstOperation === complete ? true : "retryable_failed");
    assert.deepEqual(results[1], { complete: false, fail: null });
    assert.equal(row(id).status, firstOperation === complete ? "succeeded" : "retryable_failed");
    assert.deepEqual(row(unrelated), unrelatedBefore);
    retire(id); retire(unrelated);
  }
  pass("two observed concurrent ACK races: one effective transition, no contradictory or cross-job mutation");

  for (const operation of [complete, fail]) {
    const id = fixtureJob("expire", "running", 1, "3 seconds"), before = row(id);
    const results = await race(`SELECT id FROM public.job_runs WHERE id='${id}' FOR UPDATE; SELECT json_build_object('locked',true);`,
      `${service} DO $$BEGIN
        IF NOT EXISTS(SELECT 1 FROM public.job_runs WHERE id='${id}' AND locked_until>clock_timestamp()) THEN
          RAISE EXCEPTION 'TEST_LEASE_NOT_LIVE_BEFORE_WAIT';
        END IF;
      END$$; SELECT json_build_object('result',${operation(id)});`, 4);
    assert.deepEqual(results[0], { locked: true });
    assert.equal(results[1].result, operation === complete ? false : null);
    assert.deepEqual(row(id), before);
    retire(id);
  }
  pass("two lock-wait races: expiry during row-lock wait refuses complete/fail using post-lock PostgreSQL time");

  const transfer = fixtureJob("expire", "running", 1, "-1 second");
  const transferred = await race(`${service} SELECT json_build_object('jobs',public.claim_jobs(ARRAY['expire']::text[],100,60));`,
    `${service} SELECT json_build_object('complete',${complete(transfer, 1)},'fail',${fail(transfer, 1)});`);
  assert.equal(transferred[0].jobs.find(job => job.id === transfer)?.attempt_count, 2);
  assert.deepEqual(transferred[1], { complete: false, fail: null });
  assert.equal(row(transfer).status, "running");
  assert.equal(invoke(complete(transfer, 2)), true);
  pass("observed reclaim/late-ACK race preserves new ownership and allows only current claimant completion");

  console.log("RUN unchanged Memory 8B SQL tests: explicit synthetic private plumbing, public source guards retained");
  await runMemoryTransactions(sql, connection);
  console.log(`PASS A1 final: ${groups} focused groups, ${races} observed A1 lock races; existing Memory 8B suite also passed`);
  if (fullChain) {
    assert.deepEqual(applied, migrations);
    const { verifyCurrentContracts } = await import("./current-contracts.mjs");
    const result = await verifyCurrentContracts({ sql, json, connection, root, runId, applied, container: name, started });
    console.log(`RESULT Layer1 SQL PASS; comparator execution PASS; docs ${result.drift.length ? "DRIFT (PM13)" : "MATCH"}; Layer2 NOT EXECUTED`);
    if (strictDocs) assert.equal(result.drift.length, 0, "Strict docs comparison failed: PM13 drift remains; see run artifact");
    if (generateTypes) await generateTypes({ docker, container, sql, json, root, runId });
  }
} finally {
  if (container) {
    const [identity] = JSON.parse(docker(["inspect", container]));
    assert.equal(identity.Id, container);
    assert.equal(identity.Config.Labels["campaign_lab.disposable"], `a1-${runId}`);
    assert.equal(identity.HostConfig.NetworkMode, "none");
    docker(["stop", "--time", "1", container]);
    console.log(`CLEANUP removed only this run's disposable container ${name}`);
  }
}
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await runDatabaseContracts();
