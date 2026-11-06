import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
vi.mock("server-only", () => ({}));
import { postgresClaimFixture, pgConnection } from "../fixtures/postgres-generation-claims";
import { generationQuotaPolicy } from "../../src/lib/ai/generation-quota-policy.server";
import type { Database } from "../../src/lib/supabase/database.types";

type Args = Database["public"]["Functions"]["admit_ai_generation"]["Args"];
describe.skipIf(process.env.AI_ADMISSION_POSTGRES !== "1")("Batch 04B atomic local PostgreSQL admission", () => {
  let f: Awaited<ReturnType<typeof postgresClaimFixture>>;
  beforeAll(async () => { f = await postgresClaimFixture(); console.log(`Batch 04B fixture evidence: ${f.evidence}`); }, 30000);
  beforeEach(async () => { await f.rotateQuotaNamespace(); }, 30000);
  afterAll(async () => { if (f) await f.cleanup(); }, 30000);

  function args(type: "blueprint" | "evaluation" | "memory" | "discussion" = "blueprint", owner = f.owners[0],
    daily = 100, key = type === "memory" ? `memory:${randomUUID()}:1` : randomUUID()): Args {
    const policy = generationQuotaPolicy({ ...f.quotaEnv, AI_DAILY_GENERATION_LIMIT: String(daily) }); if (!policy.success) throw Error(policy.code);
    const [minute, hour, day] = policy.windows(owner.business, new Date().toISOString()); if (!minute || !hour || !day) throw Error("Missing windows");
    return { p_business_id: owner.business, p_actor_user_id: owner.user, p_generation_id: type === "discussion" ? null : randomUUID(),
      p_generation_type: type, p_request_key: key, p_input_hash: "a".repeat(64), p_model_id: "mock-only",
      p_preorder_id: type === "discussion" ? null : owner.preorder, p_session_id: null, p_expected_version: null,
      p_context_hash: null, p_message: null, p_minute_key_hash: minute.keyHash, p_hour_key_hash: hour.keyHash,
      p_day_key_hash: day.keyHash, p_daily_limit: policy.dailyLimit };
  }
  const call = (input: Args) => f.server.rpc("admit_ai_generation", input);
  async function count(hash: string) { return Number(await pgConnection(`SELECT coalesce(sum(count),0) FROM public.rate_limit_buckets WHERE bucket_key_hash='${hash}';`)); }
  async function claims(key: string) { return Number(await pgConnection(`SELECT count(*) FROM public.ai_generations WHERE business_id='${f.owners[0].business}' AND request_key='${key}';`)); }

  it("commits six cross-module claims and three allowances, then denies the seventh without a claim or charge", async () => {
    const types = ["blueprint", "evaluation", "memory", "blueprint", "evaluation", "memory"] as const;
    const requests = types.map(type => args(type));
    for (const request of requests) expect(await call(request)).toMatchObject({ status: "claimed", generationId: request.p_generation_id });
    const denied = args("blueprint");
    expect(await call(denied)).toMatchObject({ status: "denied", window: "minute", retryAfter: expect.any(Number) });
    expect(await claims(denied.p_request_key)).toBe(0);
    for (const hash of [denied.p_minute_key_hash, denied.p_hour_key_hash, denied.p_day_key_hash]) expect(await count(hash)).toBe(6);
    expect(await call(requests[0])).toMatchObject({ status: "running", generationId: requests[0].p_generation_id });
    expect(await count(denied.p_minute_key_hash)).toBe(6);
  }, 30000);

  it("rolls back minute and hour when the configurable day cap denies a new claim", async () => {
    const first = args("evaluation", f.owners[0], 1), second = args("memory", f.owners[0], 1);
    expect(await call(first)).toMatchObject({ status: "claimed" });
    expect(await call(second)).toMatchObject({ status: "denied", window: "day" });
    expect(await claims(second.p_request_key)).toBe(0);
    for (const hash of [first.p_minute_key_hash, first.p_hour_key_hash, first.p_day_key_hash]) expect(await count(hash)).toBe(1);
  }, 30000);

  it("rolls back a newly inserted claim and minute charge when the hour bucket is full", async () => {
    const request = args("evaluation");
    await pgConnection(`INSERT INTO public.rate_limit_buckets(bucket_key_hash,window_start,count,expires_at) VALUES('${request.p_hour_key_hash}',
      date_trunc('hour',clock_timestamp(),'UTC'),30,date_trunc('hour',clock_timestamp(),'UTC')+interval '1 hour');`);
    expect(await call(request)).toMatchObject({ status: "denied", window: "hour" });
    expect(await claims(request.p_request_key)).toBe(0);
    expect(await count(request.p_minute_key_hash)).toBe(0);
    expect(await count(request.p_hour_key_hash)).toBe(30);
    expect(await count(request.p_day_key_hash)).toBe(0);
  }, 30000);

  it("uses PostgreSQL Jakarta midnight windows independently of the application clock", async () => {
    const starts = await pgConnection("SELECT date_trunc('day','2026-11-06 16:59:59+00'::timestamptz,'Asia/Jakarta')::text || '|' || date_trunc('day','2026-11-06 17:00:00+00'::timestamptz,'Asia/Jakarta')::text;");
    expect(starts).toBe("2026-11-05 17:00:00+00|2026-11-06 17:00:00+00");
  });

  it("serializes two distinct last-allowance requests on the business row", async () => {
    for (let index = 0; index < 5; index++) expect(await call(args("blueprint"))).toMatchObject({ status: "claimed" });
    const one = args("evaluation"), two = args("memory");
    const outcomes = await Promise.all([call(one), call(two)]);
    expect(outcomes.map(value => z.object({ status: z.string() }).parse(value).status).sort()).toEqual(["claimed", "denied"]);
    expect(await count(one.p_minute_key_hash)).toBe(6);
    expect(await claims(one.p_request_key) + await claims(two.p_request_key)).toBe(1);
  }, 30000);

  it("deduplicates equivalent concurrent claims and isolates another business", async () => {
    const first = args("memory");
    const outcomes = await Promise.all([call(first), call({ ...first, p_generation_id: randomUUID() })]);
    expect(outcomes.map(value => z.object({ status: z.string() }).parse(value).status).sort()).toEqual(["claimed", "running"]);
    expect(await count(first.p_minute_key_hash)).toBe(1);
    const other = args("blueprint", f.owners[1]); expect(await call(other)).toMatchObject({ status: "claimed" });
    expect(await count(other.p_minute_key_hash)).toBe(1);
  }, 30000);

  it("rolls back Strategist user message and session version on denial; client roles cannot call admission", async () => {
    const session = randomUUID(), hash = "b".repeat(64), first = args("blueprint");
    for (let index = 0; index < 6; index++) expect(await call(index === 0 ? first : args("blueprint"))).toMatchObject({ status: "claimed" });
    await pgConnection(`INSERT INTO public.campaign_ai_sessions(id,business_id,preorder_id,status,context_version_hash) VALUES('${session}','${f.owners[0].business}','${f.owners[0].preorder}','active','${hash}');`);
    const turn: Args = { ...args("discussion"), p_session_id: session, p_expected_version: 1, p_context_hash: hash, p_message: "Mocked strategy request" };
    expect(await call(turn)).toMatchObject({ status: "denied", window: "minute" });
    expect(await pgConnection(`SELECT version FROM public.campaign_ai_sessions WHERE id='${session}';`)).toBe("1");
    expect(await pgConnection(`SELECT count(*) FROM public.campaign_ai_messages WHERE session_id='${session}';`)).toBe("0");
    expect(await claims(turn.p_request_key)).toBe(0);
    await expect(f.user.rpc("admit_ai_generation", turn)).rejects.toMatchObject({ code: "42501" });
    await expect(f.anonymous.rpc("admit_ai_generation", turn)).rejects.toMatchObject({ code: "42501" });
    await expect(call({ ...args("evaluation"), p_actor_user_id: f.owners[1].user })).rejects.toMatchObject({ code: "42501" });
  }, 30000);

  it("commits a Strategist turn with one allowance and replays without another message or charge", async () => {
    const session = randomUUID(), hash = "c".repeat(64);
    await pgConnection(`INSERT INTO public.campaign_ai_sessions(id,business_id,preorder_id,status,context_version_hash) VALUES('${session}','${f.owners[0].business}','${f.owners[0].preorder}','active','${hash}');`);
    const turn: Args = { ...args("discussion"), p_session_id: session, p_expected_version: 1, p_context_hash: hash, p_message: "Mocked strategy request" };
    expect(await call(turn)).toMatchObject({ status: "claimed", claimVersion: 2 });
    expect(await call({ ...turn, p_expected_version: 1 })).toMatchObject({ status: "running" });
    expect(await count(turn.p_minute_key_hash)).toBe(1);
    expect(await pgConnection(`SELECT version FROM public.campaign_ai_sessions WHERE id='${session}';`)).toBe("2");
    expect(await pgConnection(`SELECT count(*) FROM public.campaign_ai_messages WHERE session_id='${session}';`)).toBe("1");
    expect(await claims(turn.p_request_key)).toBe(1);
  }, 30000);

  it("keeps a committed allowance after lost acknowledgement without invoking the mocked provider", async () => {
    const request = f.identity(), provider = vi.fn(async () => ({ text: "Never called" })), rpc = f.server.rpc.bind(f.server);
    f.server.rpc = async (name, values) => { await rpc(name, values); throw Error("Lost admission acknowledgement"); };
    try { await expect(f.claims().run(request, z.object({ text: z.string() }), provider)).rejects.toMatchObject({ code: "GENERATION_IN_PROGRESS" }); }
    finally { f.server.rpc = rpc; }
    expect(provider).not.toHaveBeenCalled();
    const policy = generationQuotaPolicy(f.quotaEnv); if (!policy.success) throw Error(policy.code);
    const [minute] = policy.windows(f.owners[0].business, new Date().toISOString()); if (!minute) throw Error("Missing minute");
    expect(await count(minute.keyHash)).toBe(1);
  }, 30000);
});
