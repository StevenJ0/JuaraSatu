import { verifySchemaColumns } from "../database/v2.1/tests/schema-contract.mjs";
import { runConcurrency } from "../database/v2.1/tests/concurrency.mjs";
import { runMemoryPipeline } from "../database/v2.1/tests/memory-pipeline.mjs";
import { runMemoryTransactions } from "../database/v2.1/tests/memory-transactions.mjs";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const review = resolve(root, "database/v2.1");
const image = "public.ecr.aws/supabase/postgres:17.11.0.006";
const name = `campaign-lab-v21-test-${randomUUID().slice(0, 8)}`;
let container;
const docker = (args, input) => {
  try { return execFileSync("docker", args, { input, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], maxBuffer: 10 * 1024 * 1024 }); }
  catch (error) { throw new Error(typeof error.stderr === "string" ? error.stderr.trim() : "Docker command failed"); }
};
const sql = (query, database = "postgres") => docker(["exec", "-i", container, "psql", "-h", "/tmp", "-U", "postgres", "-d", database, "-X", "-qAt", "-v", "ON_ERROR_STOP=1"], query);
const file = (name) => readFileSync(resolve(review, name), "utf8");
const pause = () => new Promise((resolve) => setTimeout(resolve, 100));
const connection = (query, database = "postgres") => new Promise((resolve, reject) => {
  const process = spawn("docker", ["exec", "-i", container, "psql", "-h", "/tmp", "-U", "postgres", "-d", database, "-X", "-qAt", "-v", "ON_ERROR_STOP=1"], { stdio: ["pipe", "pipe", "pipe"] });
  let stdout = ""; let stderr = "";
  process.stdout.on("data", (data) => { stdout += data; });
  process.stderr.on("data", (data) => { stderr += data; });
  process.on("error", reject);
  process.on("close", (code) => resolve({ code, stdout, stderr }));
  process.stdin.end(query);
});

try {
  docker(["image", "inspect", image]);
  docker(["image", "inspect", "public.ecr.aws/supabase/postgres-meta:v0.100.0"]);
  container = docker(["run", "--rm", "--detach", "--network", "none", "--name", name,
    "--label", "campaign_lab.disposable=v21-test", "--user", "postgres", "--entrypoint", "/bin/sh", image, "-c",
    "initdb -D /tmp/campaign-v21 --auth=trust --no-locale > /tmp/init.log && exec postgres -D /tmp/campaign-v21 -k /tmp -c listen_addresses=127.0.0.1 -c fsync=off",
  ]).trim();
  assert.match(container, /^[a-f0-9]{64}$/);
  let ready = false;
  for (let attempt = 0; attempt < 200; attempt++) {
    try { docker(["exec", container, "pg_isready", "-h", "/tmp", "-U", "postgres"]); ready = true; break; }
    catch { await pause(); }
  }
  assert.ok(ready, "Disposable PostgreSQL did not become ready");
  sql(file("tests/bootstrap.sql"));
  const migrations=readdirSync(resolve(root,"supabase/migrations")).filter(name=>name.endsWith(".sql")).sort();
  const memoryTransactions="20261104093000_memory_approval_and_indexing_transactions.sql";
  const originalMigrations=migrations.filter(name=>name<memoryTransactions);
  for (const migration of originalMigrations) {
    sql(readFileSync(resolve(root, "supabase/migrations", migration), "utf8"));
  }
  console.log("PASS fresh migration application on disposable PostgreSQL17");
  sql(readFileSync(resolve(root, "supabase/seed.sql"), "utf8"));
  assert.equal(sql("SELECT count(*) FROM public.businesses WHERE is_demo;").trim(), "2");
  console.log("PASS synthetic seed after migration");
  const testOutput = sql(file("tests/invariants.sql"));
  console.log(testOutput.split(/\r?\n/).filter((line) => /^(ok |not ok |#|1\.\.|Bail out!)/.test(line)).join("\n"));
  assert.ok(!/^not ok|^# Looks like|^Bail out!/m.test(testOutput), "Database assertions failed");
  assert.match(testOutput, /^1\.\.\d+$/m, "pgTAP must finish with a test plan");
  // Preserve permissive legacy assertions on their original contract; exercise hardened behavior separately.
  for(const migration of migrations.filter(name=>name>=memoryTransactions))sql(readFileSync(resolve(root,"supabase/migrations",migration),"utf8"));
  console.log("PASS complete additive chain after unchanged legacy contract tests; no user database reset");
  const columnQuery = `SELECT json_agg(json_build_object('table',table_name,'column',column_name,'type',data_type,'udt',udt_name,'length',character_maximum_length,'nullable',is_nullable) ORDER BY table_name,ordinal_position) FROM information_schema.columns WHERE table_schema='public';`;
  const columns = JSON.parse(sql(columnQuery));
  const contractCatalog = JSON.parse(sql(file("tests/catalog.sql")));
  const contract = verifySchemaColumns(readFileSync(resolve(root, "docs/schema.md"), "utf8"), contractCatalog.columns);
  assert.equal(contract.filter((row) => row.classification !== "MATCH").length, 0, "Schema column contract mismatch");
  const output = resolve(root, "node_modules/.cache/database-v21");
  mkdirSync(output, { recursive: true });
  writeFileSync(resolve(output, "catalog.json"), JSON.stringify(contractCatalog));
  writeFileSync(resolve(output, "columns.json"), JSON.stringify(columns, null, 2));
  writeFileSync(resolve(output, "schema.sql"), docker(["exec", container, "pg_dump", "-h", "/tmp", "-U", "postgres", "--schema-only", "--schema=public", "--schema=private"]));
  const catalogQuery = `SELECT json_build_object(
    'constraints',(SELECT json_agg(json_build_object('table',c.conrelid::regclass::text,'name',c.conname,'kind',c.contype,'definition',pg_get_constraintdef(c.oid)) ORDER BY c.conrelid::regclass::text,c.conname) FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname='public'),
    'indexes',(SELECT json_agg(i ORDER BY i.tablename,i.indexname) FROM pg_indexes i WHERE schemaname='public'),
    'policies',(SELECT json_agg(p ORDER BY p.tablename,p.policyname) FROM pg_policies p WHERE schemaname='public'),
    'grants',(SELECT json_agg(g ORDER BY g.table_name,g.grantee,g.privilege_type) FROM information_schema.role_table_grants g WHERE table_schema='public'),
    'triggers',(SELECT json_agg(json_build_object('table',t.tgrelid::regclass::text,'name',t.tgname,'definition',pg_get_triggerdef(t.oid)) ORDER BY t.tgrelid::regclass::text,t.tgname) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal),
    'functions',(SELECT json_agg(json_build_object('schema',n.nspname,'name',p.proname,'arguments',pg_get_function_identity_arguments(p.oid),'result',pg_get_function_result(p.oid),'definer',p.prosecdef,'grants',p.proacl::text) ORDER BY n.nspname,p.proname) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','private')),
    'extensions',(SELECT json_agg(json_build_object('name',e.extname,'version',e.extversion,'schema',n.nspname)) FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace));`;
  const targetCatalog = JSON.parse(sql(catalogQuery));
  sql("CREATE DATABASE legacy_review;");
  sql(file("tests/bootstrap.sql").split(/\r?\n/).filter((line) => !line.startsWith("CREATE ROLE")).join("\n"), "legacy_review");
  for (const migration of ["20261030210000_initial_schema.sql", "20261030225000_add_campaign_memory_and_calendar_contents.sql"]) {
    sql(readFileSync(resolve(root, "database/legacy/migrations", migration), "utf8"), "legacy_review");
  }
  const legacyColumns = JSON.parse(sql(columnQuery, "legacy_review"));
  assert.equal(new Set(legacyColumns.map((column) => column.table)).size, 19);
  writeFileSync(resolve(output, "coverage.json"), JSON.stringify({ target: { columns, ...targetCatalog }, legacy: { columns: legacyColumns, ...JSON.parse(sql(catalogQuery, "legacy_review")) } }, null, 2));
  console.log("PASS legacy chain independently compiled: 19 tables; full catalog comparison captured");
  const generatedTypes = docker(["run", "--rm", "--network", `container:${container}`,
    "-e", "PG_META_DB_HOST=127.0.0.1", "-e", "PG_META_DB_USER=postgres", "-e", "PG_META_DB_NAME=postgres",
    "-e", "PG_META_GENERATE_TYPES=typescript", "-e", "PG_META_GENERATE_TYPES_INCLUDED_SCHEMAS=public",
    "public.ecr.aws/supabase/postgres-meta:v0.100.0"]);
  assert.ok(generatedTypes.includes("export type Database ="));
  assert.ok(!/\bany\b/.test(generatedTypes), "Generated types must not contain any");
  writeFileSync(resolve(output, "database.types.ts"), generatedTypes);
  // Canonical application types come from the real local stack via test-supabase-v21.mjs --write-types.
  console.log("PASS TypeScript types generated from actual PostgreSQL using Supabase postgres-meta");
  console.log(`PASS schema contract coverage: ${contractCatalog.tables.length} tables / ${columns.length} columns`);
  await runConcurrency(sql, connection);
  // Retain the existing sandbox SQL fixture only in a separate disposable database; original tests still roll back unchanged.
  sql("CREATE DATABASE memory_review;");
  sql(file("tests/bootstrap.sql").split(/\r?\n/).filter((line)=>!line.startsWith("CREATE ROLE")).join("\n"),"memory_review");
  for(const migration of originalMigrations)sql(readFileSync(resolve(root,"supabase/migrations",migration),"utf8"),"memory_review");
  sql(readFileSync(resolve(root,"supabase/seed.sql"),"utf8"),"memory_review");
  const retainedFixture=sql(file("tests/invariants.sql").replace(/ROLLBACK;\s*$/,"COMMIT;"),"memory_review");
  assert.ok(!/^not ok|^# Looks like|^Bail out!/m.test(retainedFixture),"Isolated legacy sandbox fixture must retain every assertion");
  await runMemoryPipeline((query)=>sql(query,"memory_review"),(query)=>connection(query,"memory_review"));
  for(const migration of migrations.filter(name=>name>=memoryTransactions))sql(readFileSync(resolve(root,"supabase/migrations",migration),"utf8"),"memory_review");
  await runMemoryTransactions((query)=>sql(query,"memory_review"),(query)=>connection(query,"memory_review"));
} finally {
  if (container) {
    const label = docker(["inspect", container, "--format", '{{index .Config.Labels "campaign_lab.disposable"}}']).trim();
    assert.equal(label, "v21-test", "Refusing to stop an unrelated container");
    docker(["stop", "--time", "1", container]);
  }
}
