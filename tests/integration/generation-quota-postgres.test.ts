import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { quotaPostgresFixture } from "../fixtures/quota-postgres";

describe.skipIf(process.env.AI_QUOTA_POSTGRES !== "1")("F06 actual PostgreSQL primitive verification, not integrated quota admission", () => {
  let f: Awaited<ReturnType<typeof quotaPostgresFixture>>;
  beforeAll(async () => { f = await quotaPostgresFixture(); }, 30000);
  afterAll(async () => { if (f) await f.cleanup(); }, 30000);
  it("minute primitive admits6, rejects7, but the denied attempt is still counted", async () => {
    const business = randomUUID(), windows = await f.buckets(undefined, 100, business), minute = windows[0];
    expect(await f.many(minute, 7)).toEqual([true, true, true, true, true, true, false]); expect(await f.count(minute)).toBe(7);
    const next = (await f.buckets("2026-11-06T03:05:00Z", 100, business))[0]; expect(await f.take(next)).toBe(true); expect(await f.count(next)).toBe(1);
  });
  it("hour primitive admits30 then rejects31 and the next hour has an independent counter", async () => {
    const business = randomUUID(), hour = (await f.buckets(undefined, 100, business))[1];
    const results = await f.many(hour, 31); expect(results.filter(Boolean)).toHaveLength(30); expect(results[30]).toBe(false); expect(await f.count(hour)).toBe(31);
    expect(await f.take((await f.buckets("2026-11-06T04:00:00Z", 100, business))[1])).toBe(true);
  });
  it("configurable daily primitive uses the policy's exact midnight WIB boundary", async () => {
    const business = randomUUID(), day = (await f.buckets("2026-11-06T16:59:59.999Z", 2, business))[2];
    expect(await f.many(day, 3)).toEqual([true, true, false]);
    const next = (await f.buckets("2026-11-06T17:00:00Z", 2, business))[2]; expect(next.windowStart).toBe(day.expiresAt); expect(await f.take(next)).toBe(true);
  });
  it("two actual connections race for the final allowance: one admitted, one rejected", async () => {
    const minute = (await f.buckets())[0]; await f.many(minute, 5);
    const results = await Promise.all([f.take(minute), f.take(minute)]); expect(results.sort()).toEqual([false, true]); expect(await f.count(minute)).toBe(7);
  });
  it("server-derived HMAC keys isolate business counters; RPC itself receives no business identity", async () => {
    const own = (await f.buckets())[0], foreign = (await f.buckets())[0];
    await f.many(own, 7); expect(await f.take(foreign)).toBe(true); expect(await f.count(own)).toBe(7); expect(await f.count(foreign)).toBe(1);
  });
  it("BLOCKER: independent multi-window RPCs charge a rejected generation partially", async () => {
    const windows = await f.buckets(), minute = windows[0], hour = { ...windows[1], limit: 1 };
    expect(await f.take(hour)).toBe(true);
    expect(await f.take(minute)).toBe(true); expect(await f.take(hour)).toBe(false);
    expect(await f.count(minute)).toBe(1); expect(await f.count(hour)).toBe(2); expect(await f.count(windows[2])).toBe(0);
  });
  it("BLOCKER: replaying identical RPC arguments is another charge, not an idempotent reservation", async () => {
    const minute = (await f.buckets())[0]; expect(await f.take(minute)).toBe(true); expect(await f.take(minute)).toBe(true); expect(await f.count(minute)).toBe(2);
  });
  it("expiry is metadata: expired same-key buckets remain counted and conflict does not update expires_at", async () => {
    const minute = { ...(await f.buckets())[0], limit: 1 }; expect(await f.take(minute)).toBe(true);
    expect(await f.take({ ...minute, expiresAt: "2026-11-07T03:05:00Z" })).toBe(false); expect(await f.count(minute)).toBe(2);
    const rows = await f.queryAs(`SELECT jsonb_agg(to_jsonb(t)) FROM public.rate_limit_buckets t WHERE ${f.filter(minute)};`);
    expect(rows).toMatchObject([{ expires_at: "2026-11-06T03:05:00+00:00" }]);
  });
  it("authenticated/anon cannot call the RPC or read/write quota buckets", async () => {
    const minute = (await f.buckets())[0];
    for (const role of ["authenticated", "anon"] as const) {
      await expect(f.take(minute, role)).rejects.toMatchObject({ code: "42501" });
      await expect(f.queryAs("SELECT to_jsonb(count(*)) FROM public.rate_limit_buckets;", role)).rejects.toMatchObject({ code: "42501" });
      await expect(f.queryAs(`INSERT INTO public.rate_limit_buckets(bucket_key_hash,window_start,count,expires_at) VALUES('${minute.keyHash}','${minute.windowStart}',1,'${minute.expiresAt}'); SELECT to_jsonb(true);`, role)).rejects.toMatchObject({ code: "42501" });
      await expect(f.queryAs(`UPDATE public.rate_limit_buckets SET count=0 WHERE ${f.filter(minute)}; SELECT to_jsonb(true);`, role)).rejects.toMatchObject({ code: "42501" });
    }
    expect(await f.count(minute)).toBe(0);
  });
  it("invalid bucket parameters are rejected before mutating the counter", async () => {
    const minute = (await f.buckets())[0];
    await expect(f.queryAs(`SELECT to_jsonb(public.take_rate_limit('${minute.keyHash}','${minute.windowStart}','${minute.expiresAt}',0));`)).rejects.toMatchObject({ code: "22023" });
    await expect(f.take({ ...minute, expiresAt: minute.windowStart })).rejects.toMatchObject({ code: "22023" });
    expect(await f.count(minute)).toBe(0);
  });
});
