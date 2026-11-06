import { spawn, execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { generationClaims } from "../../src/lib/ai/generation-claims.server";
import { generationQuotaPolicy } from "../../src/lib/ai/generation-quota-policy.server";
import { SupabaseError, type SupabaseTransport } from "../../src/lib/supabase/transport.server";

const container = "supabase_db_campaign-lab";
const args = ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose"];
const literal = (value: unknown): string => value === null ? "NULL" : typeof value === "boolean" || typeof value === "number" ? String(value)
  : typeof value === "string" ? `'${value.replaceAll("'", "''")}'` : `${literal(JSON.stringify(value))}::jsonb`;
function identifier(value: string) { if (!/^[a-z_]+$/.test(value)) throw Error("Invalid SQL identifier"); return `"${value}"`; }
export function pgConnection(input: string) {
  const child = spawn("docker", args, { stdio: ["pipe", "pipe", "pipe"] }); let stdout = "", stderr = "";
  const done = new Promise<string>((complete, reject) => {
    child.stdout.on("data", data => { stdout += String(data); }); child.stderr.on("data", data => { stderr += String(data); });
    child.on("error", reject); child.on("close", code => code === 0 ? complete(stdout.trim()) : reject(new SupabaseError(/ERROR:\s+([A-Z0-9]{5}):/.exec(stderr)?.[1] ?? "DATABASE_ERROR", stderr, 500)));
  });
  child.stdin.end(`SET statement_timeout='15s'; SET lock_timeout='10s'; ${input}`); return done;
}
async function json(input: string): Promise<unknown> { const output = await pgConnection(input); const value: unknown = JSON.parse(output); return value; }
const trackedTables = ["ai_generations", "campaign_ai_sessions", "campaign_ai_messages", "businesses", "business_members", "preorders", "campaigns", "campaign_evaluations", "campaign_memories", "job_runs"];
async function snapshot() {
  return json(`SELECT jsonb_build_object(${trackedTables.flatMap(table => [literal(table), `(SELECT jsonb_build_object('count',count(*),'digest',md5(coalesce(string_agg(row_to_json(t)::text,chr(10) ORDER BY id),''))) FROM public.${identifier(table)} t)`]).join(",")},
    'rate_limit_buckets',(SELECT jsonb_build_object('count',count(*),'digest',md5(coalesce(string_agg(row_to_json(t)::text,chr(10) ORDER BY bucket_key_hash,window_start),''))) FROM public.rate_limit_buckets t),
    'auth_users',(SELECT jsonb_build_object('count',count(*),'digest',md5(coalesce(string_agg(row_to_json(t)::text,chr(10) ORDER BY id),''))) FROM auth.users t));`);
}
export async function postgresClaimFixture() {
  const endpoint = z.string().parse(JSON.parse(execFileSync("docker", ["context", "inspect", "--format", "{{json .Endpoints.docker.Host}}"], { encoding: "utf8" })));
  if (!endpoint.startsWith("npipe://") && !endpoint.startsWith("unix://")) throw Error("Only a local Docker engine is authorized");
  const labelsValue: unknown = JSON.parse(execFileSync("docker", ["inspect", container, "--format", "{{json .Config.Labels}}"], { encoding: "utf8" }));
  const labels = z.record(z.string(), z.string()).parse(labelsValue);
  if (labels["com.supabase.cli.project"] !== "campaign-lab" || resolve(labels["com.supabase.cli.workdir"]).toLowerCase() !== process.cwd().toLowerCase() ||
    !/^project_id = "campaign-lab"$/m.test(readFileSync("supabase/config.toml", "utf8"))) throw Error("Not the authorized local Campaign Lab database");
  const version = await json("SELECT jsonb_build_object('database',current_database(),'memoryMigration',EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20261106090000'));");
  z.object({ database: z.literal("postgres"), memoryMigration: z.literal(true) }).parse(version);
  const runId = randomUUID(), marker = `batch03b-memory-${runId}`, before = await snapshot();
  const owners = [0, 1].map(index => ({ user: randomUUID(), business: randomUUID(), preorder: randomUUID(), membership: randomUUID(), slug: `${marker}-${index}` }));
  const quotaEnv = { RATE_LIMIT_HMAC_KEY: randomBytes(32).toString("hex") };
  const quota = generationQuotaPolicy(quotaEnv); if (!quota.success) throw Error(quota.code);
  const quotaHashes = owners.flatMap(owner => quota.windows(owner.business, new Date().toISOString()).map(window => window.keyHash));
  if (await pgConnection(`SELECT count(*) FROM public.rate_limit_buckets WHERE bucket_key_hash IN (${quotaHashes.map(literal).join(",")});`) !== "0") throw Error("Fixture quota key collision");
  const evidence = resolve("node_modules/.cache/batch03b-memory-claims", `${runId}.json`); mkdirSync(resolve(evidence, ".."), { recursive: true });
  const record = (phase: string, extra: Record<string, unknown> = {}) => writeFileSync(evidence, JSON.stringify({ runId, marker, target: container, owners, before, phase, ...extra }, null, 2));
  record("preflight");
  await pgConnection(`BEGIN; ${owners.map(owner => `
    INSERT INTO auth.users(id,aud,role,email,raw_user_meta_data) VALUES(${literal(owner.user)},'authenticated','authenticated',${literal(`${owner.slug}@example.invalid`)},${literal({ batch03b: runId })});
    INSERT INTO public.businesses(id,name,slug,category,pickup_instructions,is_demo) VALUES(${literal(owner.business)},${literal(marker)},${literal(owner.slug)},'Disposable concurrency test','No fulfillment',true);
    INSERT INTO public.business_members(id,business_id,user_id) VALUES(${literal(owner.membership)},${literal(owner.business)},${literal(owner.user)});
    INSERT INTO public.preorders(id,business_id,name,status,fulfillment_date,starts_at,ends_at) VALUES(${literal(owner.preorder)},${literal(owner.business)},${literal(marker)},'draft',current_date+10,now(),now()+interval '9 days');`).join("\n")} COMMIT;`);
  record("fixtures_created");
  function transport(owner: typeof owners[number], role: "authenticated" | "service_role" | "anon"): SupabaseTransport {
    const run = (input: string) => json(`BEGIN; SET LOCAL ROLE ${role}; SET LOCAL request.jwt.claim.role=${literal(role)}; SET LOCAL request.jwt.claim.sub=${literal(owner.user)}; ${input} COMMIT;`);
    function where(query: Record<string, string>) {
      return Object.entries(query).filter(([key]) => !["select", "limit"].includes(key)).map(([key, value]) => {
        if (!value.startsWith("eq.")) throw Error("Unexpected filter"); return `${identifier(key)}=${literal(value.slice(3))}`;
      }).join(" AND ");
    }
    return {
      async select(table, query) {
        if (table !== "ai_generations") throw Error("Unexpected table");
        return run(`SELECT coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) FROM (SELECT * FROM public.ai_generations WHERE ${where(query)}) t;`);
      },
      async rpc(name, raw) {
        if (name === "is_business_owner") {
          const parsed = z.object({ target_business_id: z.uuid() }).parse(raw); return run(`SELECT to_jsonb(public.is_business_owner(${literal(parsed.target_business_id)}));`);
        }
        if (name === "admit_ai_generation") {
          const parsed = z.record(z.string(), z.unknown()).parse(raw);
          const fields = ["p_business_id","p_actor_user_id","p_generation_id","p_generation_type","p_request_key","p_input_hash","p_model_id",
            "p_preorder_id","p_session_id","p_expected_version","p_context_hash","p_message","p_minute_key_hash","p_hour_key_hash","p_day_key_hash","p_daily_limit"];
          return run(`SELECT public.admit_ai_generation(${fields.map(field => literal(parsed[field])).join(",")});`);
        }
        throw Error("Unexpected RPC");
      },
      async insert(table, raw) {
        if (table !== "ai_generations") throw Error("Unexpected table");
        const value = z.record(z.string(), z.unknown()).parse(raw), columns = Object.keys(value);
        return run(`WITH saved AS(INSERT INTO public.ai_generations(${columns.map(identifier).join(",")}) VALUES(${columns.map(key => literal(value[key])).join(",")}) RETURNING *) SELECT coalesce(jsonb_agg(to_jsonb(saved)),'[]'::jsonb) FROM saved;`);
      },
      async update(table, query, raw) {
        if (table !== "ai_generations") throw Error("Unexpected table");
        const value = z.record(z.string(), z.unknown()).parse(raw);
        return run(`WITH saved AS(UPDATE public.ai_generations SET ${Object.entries(value).map(([key, item]) => `${identifier(key)}=${literal(item)}`).join(",")} WHERE ${where(query)} RETURNING *) SELECT coalesce(jsonb_agg(to_jsonb(saved)),'[]'::jsonb) FROM saved;`);
      },
    };
  }
  let at = Date.now(); const now = () => new Date(at).toISOString();
  const user = transport(owners[0], "authenticated"), other = transport(owners[1], "authenticated"), server = transport(owners[0], "service_role"), anonymous = transport(owners[0], "anon");
  const identity = () => ({ type: "memory" as const, requestKey: `memory:${randomUUID()}:1`, inputHash: "a".repeat(64), preorderId: owners[0].preorder, model: "gemini-test" });
  return { owners, runId, marker, quotaEnv, user, other, server, anonymous, now, identity, evidence, transport, advance(ms: number) { at = Date.now() + ms; },
    async rotateQuotaNamespace() {
      quotaEnv.RATE_LIMIT_HMAC_KEY = randomBytes(32).toString("hex");
      const policy = generationQuotaPolicy(quotaEnv); if (!policy.success) throw Error(policy.code);
      const hashes = owners.flatMap(owner => policy.windows(owner.business, new Date().toISOString()).map(window => window.keyHash));
      if (await pgConnection(`SELECT count(*) FROM public.rate_limit_buckets WHERE bucket_key_hash IN (${hashes.map(literal).join(",")});`) !== "0") throw Error("Fixture quota key collision");
      quotaHashes.push(...hashes);
    },
    claims: (owner = owners[0], reader = user) => generationClaims(reader, () => server, owner.business, now, owner.user, quotaEnv),
    async rows() { return z.array(z.record(z.string(), z.unknown())).parse(await server.select("ai_generations", { business_id: `eq.${owners[0].business}` })); },
    async cleanup() {
      // IDs and task markers must both match; no historical business/Evaluation/Memory is touched.
      try {
        await pgConnection(`BEGIN; DO $$ BEGIN
          ${owners.map(owner => `IF NOT EXISTS(SELECT 1 FROM public.businesses b JOIN public.business_members m ON m.business_id=b.id JOIN auth.users u ON u.id=m.user_id JOIN public.preorders p ON p.business_id=b.id
            WHERE b.id=${literal(owner.business)} AND b.slug=${literal(owner.slug)} AND b.name=${literal(marker)} AND b.is_demo AND m.id=${literal(owner.membership)} AND u.id=${literal(owner.user)} AND u.email=${literal(`${owner.slug}@example.invalid`)} AND u.raw_user_meta_data->>'batch03b'=${literal(runId)} AND p.id=${literal(owner.preorder)} AND p.name=${literal(marker)}) THEN RAISE EXCEPTION 'FIXTURE_OWNERSHIP_MISMATCH'; END IF;`).join("\n")}
          END $$;
          -- The append-only message trigger also protects disposable test rows; bypass it only for this scoped cleanup.
          SET LOCAL session_replication_role=replica;
          DELETE FROM public.campaign_ai_messages WHERE business_id IN (${owners.map(owner => literal(owner.business)).join(",")});
          SET LOCAL session_replication_role=origin;
          DELETE FROM public.ai_generations WHERE business_id IN (${owners.map(owner => literal(owner.business)).join(",")});
          DELETE FROM public.campaign_ai_sessions WHERE business_id IN (${owners.map(owner => literal(owner.business)).join(",")});
          DELETE FROM public.rate_limit_buckets WHERE bucket_key_hash IN (${quotaHashes.map(literal).join(",")});
          ${owners.map(owner => `DELETE FROM public.preorders WHERE id=${literal(owner.preorder)} AND business_id=${literal(owner.business)};
            DELETE FROM public.business_members WHERE id=${literal(owner.membership)} AND user_id=${literal(owner.user)} AND business_id=${literal(owner.business)};
            DELETE FROM public.businesses WHERE id=${literal(owner.business)} AND slug=${literal(owner.slug)};
            DELETE FROM auth.users WHERE id=${literal(owner.user)} AND raw_user_meta_data->>'batch03b'=${literal(runId)};`).join("\n")}
          COMMIT;`);
        const after = await snapshot(); record("cleaned", { after, preserved: JSON.stringify(before) === JSON.stringify(after) });
        if (JSON.stringify(before) !== JSON.stringify(after)) throw Error("Historical data changed; inspect task evidence");
      } catch (error) { record("cleanup_failed", { code: error instanceof SupabaseError ? error.code : "VERIFICATION_FAILED" }); throw error; }
    },
  };
}

export async function heldPgInsert(insert: string, applicationName: string) {
  const child = spawn("docker", args, { stdio: ["pipe", "pipe", "pipe"] }); let stdout = "", stderr = "", ready: () => void = () => {};
  const marker = new Promise<void>(complete => { ready = complete; });
  const done = new Promise<void>((complete, reject) => {
    child.stdout.on("data", data => { stdout += String(data); if (stdout.includes("BATCH03B_HELD")) ready(); });
    child.stderr.on("data", data => { stderr += String(data); }); child.on("error", reject);
    child.on("close", code => code === 0 ? complete() : reject(Error(stderr)));
  });
  child.stdin.write(`BEGIN; SET LOCAL statement_timeout='15s'; SET LOCAL application_name=${literal(applicationName)}; ${insert} SELECT 'BATCH03B_HELD';\n`);
  await Promise.race([marker, done.then(() => { throw Error("Connection closed before INSERT barrier"); })]);
  return { async commit() { child.stdin.end("COMMIT;\n"); await done; } };
}
