import { execFileSync } from "node:child_process";
import { randomUUID, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { pgConnection } from "./postgres-generation-claims";
import { generationQuotaPolicy } from "../../src/lib/ai/generation-quota-policy.server";

const Container = "supabase_db_campaign-lab";
const Bucket = z.object({ kind: z.enum(["minute", "hour", "day"]), keyHash: z.string().regex(/^[a-f0-9]{64}$/),
  windowStart: z.iso.datetime({ offset: true }), expiresAt: z.iso.datetime({ offset: true }), limit: z.number().int().positive() });
type Bucket = z.infer<typeof Bucket>;
const Row = z.object({ bucket_key_hash: z.string(), window_start: z.iso.datetime({ offset: true }), expires_at: z.iso.datetime({ offset: true }), count: z.number().int().nonnegative() });
const tables = ["businesses", "business_members", "preorders", "campaigns", "campaign_evaluations", "campaign_memories", "ai_generations", "job_runs"];
async function json(input: string): Promise<unknown> { const value: unknown = JSON.parse(await pgConnection(input)); return value; }
async function snapshot() {
  return json(`SELECT jsonb_build_object(${tables.flatMap(table => [`'${table}'`, `(SELECT jsonb_build_object('count',count(*),'digest',md5(coalesce(string_agg(row_to_json(t)::text,chr(10) ORDER BY id),''))) FROM public.${table} t)`]).join(",")},
    'rate_limit_buckets',(SELECT jsonb_build_object('count',count(*),'digest',md5(coalesce(string_agg(row_to_json(t)::text,chr(10) ORDER BY bucket_key_hash,window_start),''))) FROM public.rate_limit_buckets t),
    'take_rate_limit_definition_md5',md5(pg_get_functiondef('public.take_rate_limit(text,timestamptz,timestamptz,integer)'::regprocedure)),
    'migration_count',(SELECT count(*) FROM supabase_migrations.schema_migrations));`);
}
export async function quotaPostgresFixture() {
  const endpoint = z.string().parse(JSON.parse(execFileSync("docker", ["context", "inspect", "--format", "{{json .Endpoints.docker.Host}}"], { encoding: "utf8" })));
  const labels = z.record(z.string(), z.string()).parse(JSON.parse(execFileSync("docker", ["inspect", Container, "--format", "{{json .Config.Labels}}"], { encoding: "utf8" })));
  if ((!endpoint.startsWith("npipe://") && !endpoint.startsWith("unix://")) || labels["com.supabase.cli.project"] !== "campaign-lab" ||
    resolve(labels["com.supabase.cli.workdir"]).toLowerCase() !== process.cwd().toLowerCase() || !/^project_id = "campaign-lab"$/m.test(readFileSync("supabase/config.toml", "utf8"))) throw Error("Not the authorized local Campaign Lab database");
  if (await pgConnection("SELECT current_database();") !== "postgres") throw Error("Wrong local database");
  const runId = randomUUID(), secret = randomBytes(32).toString("hex"), registered: Bucket[] = [], before = await snapshot();
  const phases: { phase: string; at: string }[] = [], evidence = resolve("node_modules/.cache/batch04-generation-quota", `${runId}.json`);
  mkdirSync(resolve(evidence, ".."), { recursive: true });
  const record = (phase: string, extra: Record<string, unknown> = {}) => {
    phases.push({ phase, at: new Date().toISOString() });
    writeFileSync(evidence, JSON.stringify({ runId, target: Container, phases, registered, before, phase, ...extra }, null, 2));
  };
  record("preflight");
  function filter(bucket: Bucket) { const b = Bucket.parse(bucket); return `bucket_key_hash='${b.keyHash}' AND window_start='${b.windowStart}'`; }
  const argumentsSql = (bucket: Bucket) => { const b = Bucket.parse(bucket); return `'${b.keyHash}','${b.windowStart}','${b.expiresAt}',${b.limit}`; };
  async function queryAs(input: string, role: "service_role" | "authenticated" | "anon" = "service_role") {
    return json(`BEGIN; SET LOCAL ROLE ${role}; SET LOCAL request.jwt.claim.role='${role}'; ${input} COMMIT;`);
  }
  return { runId, evidence, before, queryAs, filter,
    async buckets(at = "2026-11-06T03:04:05Z", daily = 100, business = randomUUID()) {
      const policy = generationQuotaPolicy({ RATE_LIMIT_HMAC_KEY: secret, AI_DAILY_GENERATION_LIMIT: String(daily) }); if (!policy.success) throw Error(policy.code);
      const buckets = policy.windows(business, at);
      for (const bucket of buckets) if (!registered.some(item => item.keyHash === bucket.keyHash && item.windowStart === bucket.windowStart)) {
        if (await pgConnection(`SELECT count(*) FROM public.rate_limit_buckets WHERE ${filter(bucket)};`) !== "0") throw Error("Fixture key collision");
        registered.push(bucket);
      }
      record("task_keys_registered"); return buckets;
    },
    take: (bucket: Bucket, role: "service_role" | "authenticated" | "anon" = "service_role") => queryAs(`SELECT to_jsonb(public.take_rate_limit(${argumentsSql(bucket)}));`, role).then(value => z.boolean().parse(value)),
    many: (bucket: Bucket, count: number) => {
      z.number().int().min(1).max(100).parse(count);
      return queryAs(`SELECT jsonb_agg(public.take_rate_limit(${argumentsSql(bucket)})) FROM generate_series(1,${count});`).then(value => z.array(z.boolean()).parse(value));
    },
    async count(bucket: Bucket) { return Number(await pgConnection(`SELECT coalesce((SELECT count FROM public.rate_limit_buckets WHERE ${filter(bucket)}),0);`)); },
    async cleanup() {
      try {
        const where = registered.map(bucket => `(${filter(bucket)})`).join(" OR ") || "false";
        const rows = z.array(Row).parse(await json(`SELECT coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) FROM public.rate_limit_buckets t WHERE ${where};`));
        for (const row of rows) {
          const owned = registered.find(bucket => bucket.keyHash === row.bucket_key_hash && Date.parse(bucket.windowStart) === Date.parse(row.window_start));
          if (!owned || Date.parse(owned.expiresAt) !== Date.parse(row.expires_at)) throw Error("Fixture ownership mismatch; cleanup refused");
        }
        record("cleanup_verified", { taskRows: rows });
        await pgConnection(`BEGIN; DELETE FROM public.rate_limit_buckets WHERE ${where}; COMMIT;`);
        const after = await snapshot(), preserved = JSON.stringify(before) === JSON.stringify(after); record("cleaned", { after, preserved, taskRows: rows });
        if (!preserved) throw Error("Historical data or RPC changed; inspect fixture evidence");
      } catch (error) { record("cleanup_failed"); throw error; }
    },
  };
}
