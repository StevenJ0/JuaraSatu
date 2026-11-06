import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
vi.mock("server-only", () => ({}));
import { generationClaims, GenerationClaimError } from "../../src/lib/ai/generation-claims.server";
import { generationClaimFixture } from "../fixtures/generation-claims";

const Result = z.object({ text: z.string(), status: z.enum(["available", "invalid", "failed"]).optional() });
function setup() {
  let at = Date.parse("2026-11-06T03:00:00Z"); const businessId = randomUUID(), now = () => new Date(at).toISOString();
  const fixture = generationClaimFixture(businessId, now);
  const identity = { type: "blueprint" as const, requestKey: randomUUID(), inputHash: "a".repeat(64), preorderId: randomUUID(), model: "development-fake-blueprint" };
  return { ...fixture, identity, businessId, now, advance: (ms: number) => { at += ms; } };
}
function deferred<T>() { let resolve: (value: T) => void = () => {}; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }

describe("sessionless generation claims over existing atomic INSERT/conditional UPDATE contracts", () => {
  it("returns running for an active claim across two coordinator instances, then replays", async () => {
    const f = setup(), gate = deferred<{ text: string }>(), entered = deferred<void>();
    const generate = vi.fn(async () => { entered.resolve(); return gate.promise; });
    const first = f.instance().run(f.identity, Result, generate); await entered.promise;
    await expect(f.instance().run(f.identity, Result, generate)).rejects.toMatchObject({ code: "GENERATION_IN_PROGRESS", status: 409 });
    expect(generate).toHaveBeenCalledTimes(1); gate.resolve({ text: "Valid plan" });
    expect(await first).toEqual({ text: "Valid plan" }); expect(f.rows).toHaveLength(1);
    expect(await f.instance().run(f.identity, Result, generate)).toEqual({ text: "Valid plan" }); expect(generate).toHaveBeenCalledTimes(1);
  });
  it("arbitrates simultaneous INSERTs when both initial reads find no claim", async () => {
    const f = setup(), reads = deferred<void>(), gate = deferred<{ text: string }>(), entered = deferred<void>();
    const select = f.user.select.bind(f.user); let initialReads = 0;
    f.user.select = async (table, query) => {
      if (++initialReads <= 2) { if (initialReads === 2) reads.resolve(); await reads.promise; return []; }
      return select(table, query);
    };
    const generate = vi.fn(async () => { entered.resolve(); return gate.promise; });
    const requests = [f.instance().run(f.identity, Result, generate), f.instance().run(f.identity, Result, generate)];
    const outcomes = Promise.allSettled(requests);
    await entered.promise;
    const rejected = await Promise.race(requests.map(request => request.catch(error => error)));
    expect(rejected).toMatchObject({ code: "GENERATION_IN_PROGRESS" }); expect(generate).toHaveBeenCalledTimes(1);
    gate.resolve({ text: "Winner" });
    expect((await outcomes).map(result => result.status).sort()).toEqual(["fulfilled", "rejected"]); expect(f.rows).toHaveLength(1);
  });
  it("detects conflicting hash/preorder under an active identical request identity", async () => {
    const f = setup(), gate = deferred<{ text: string }>(), entered = deferred<void>();
    const generate = vi.fn(async () => { entered.resolve(); return gate.promise; });
    const first = f.instance().run(f.identity, Result, generate); await entered.promise;
    for (const change of [{ inputHash: "b".repeat(64) }, { preorderId: randomUUID() }]) await expect(f.instance().run({ ...f.identity, ...change }, Result, generate)).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    expect(f.rows[0].input_hash).toBe(f.identity.inputHash); gate.resolve({ text: "Original" }); await first; expect(generate).toHaveBeenCalledTimes(1);
  });
  it("does not deduplicate unrelated request keys or generation types", async () => {
    const f = setup(), generate = vi.fn(async () => ({ text: "Independent" }));
    await Promise.all([f.instance().run(f.identity, Result, generate), f.instance().run({ ...f.identity, requestKey: randomUUID() }, Result, generate),
      f.instance().run({ ...f.identity, type: "evaluation" }, Result, generate)]);
    expect(generate).toHaveBeenCalledTimes(3); expect(f.rows).toHaveLength(3);
  });
  it.each(["PROVIDER_TIMEOUT", "INVALID_BLUEPRINT", "PROVIDER_UNAVAILABLE"])("retains %s without blind retry and permits explicit new work", async code => {
    const f = setup(), generate = vi.fn(async () => { throw new GenerationClaimError(code, 503); });
    await expect(f.instance().run(f.identity, Result, generate)).rejects.toMatchObject({ code });
    await expect(f.instance().run(f.identity, Result, generate)).rejects.toMatchObject({ code }); expect(generate).toHaveBeenCalledTimes(1);
    expect(await f.instance().run({ ...f.identity, requestKey: randomUUID() }, Result, async () => ({ text: "New request" }))).toEqual({ text: "New request" });
  });
  it.each(["failed", "invalid"] as const)("checkpoints a durable %s Evaluation outcome without treating it as available", async status => {
    const f = setup(), generate = vi.fn(async () => ({ text: "No narrative", status }));
    expect(await f.instance().run({ ...f.identity, type: "evaluation" }, Result, generate)).toMatchObject({ status });
    expect(await f.instance().run({ ...f.identity, type: "evaluation" }, Result, generate)).toMatchObject({ status });
    expect(f.rows[0].status).toBe(status === "failed" ? "failed" : "invalid_output"); expect(generate).toHaveBeenCalledTimes(1);
  });
  it("expired interrupted work becomes terminal; late provider completion is fenced out", async () => {
    const f = setup(), gate = deferred<{ text: string }>(), entered = deferred<void>();
    const generate = vi.fn(async () => { entered.resolve(); return gate.promise; });
    const first = f.instance().run(f.identity, Result, generate), observed = first.catch(error => error); await entered.promise;
    f.advance(180001);
    await expect(f.instance().run(f.identity, Result, generate)).rejects.toMatchObject({ code: "GENERATION_INTERRUPTED" });
    gate.resolve({ text: "Late output" }); expect(await observed).toMatchObject({ code: "GENERATION_INTERRUPTED" });
    expect(generate).toHaveBeenCalledTimes(1); expect(f.rows[0]).toMatchObject({ status: "failed", output_json: null });
  });
  it("does not infer after an ambiguous admission acknowledgement", async () => {
    const f = setup(), rpc = f.server.rpc.bind(f.server); f.server.rpc = async (name, values) => { await rpc(name, values); throw Error("Lost admission response"); };
    const generate = vi.fn(async () => ({ text: "Must not execute" }));
    await expect(f.instance().run(f.identity, Result, generate)).rejects.toMatchObject({ code: "GENERATION_IN_PROGRESS" }); expect(generate).not.toHaveBeenCalled();
    f.advance(180001); await expect(f.instance().run(f.identity, Result, generate)).rejects.toMatchObject({ code: "GENERATION_INTERRUPTED" }); expect(generate).not.toHaveBeenCalled();
  });
  it("reconciles an ambiguously committed output checkpoint without reinference", async () => {
    const f = setup(), update = f.server.update.bind(f.server); f.server.update = async (table, query, values) => { await update(table, query, values); throw Error("Lost checkpoint response"); };
    const generate = vi.fn(async () => ({ text: "Saved" }));
    expect(await f.instance().run(f.identity, Result, generate)).toEqual({ text: "Saved" });
    expect(await f.instance().run(f.identity, Result, generate)).toEqual({ text: "Saved" }); expect(generate).toHaveBeenCalledTimes(1);
  });
  it("uncommitted output checkpoint failure retains a running claim and never reexecutes inference", async () => {
    const f = setup(); f.server.update = async () => { throw Error("Storage unavailable"); }; const generate = vi.fn(async () => ({ text: "Unsaved" }));
    await expect(f.instance().run(f.identity, Result, generate)).rejects.toThrow("Storage unavailable");
    await expect(f.instance().run(f.identity, Result, generate)).rejects.toMatchObject({ code: "GENERATION_IN_PROGRESS" }); expect(generate).toHaveBeenCalledTimes(1);
  });
  it("normalizes untrusted failure metadata and rejects schema-invalid output", async () => {
    const f = setup(), generate = vi.fn(async () => ({ text: 99 }));
    await expect(f.instance().run(f.identity, Result, generate)).rejects.toBeInstanceOf(z.ZodError);
    await expect(f.instance().run(f.identity, Result, generate)).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE", status: 503 }); expect(generate).toHaveBeenCalledTimes(1);
    expect(f.rows[0].output_json).toEqual({ kind: "error", error: { code: "PROVIDER_UNAVAILABLE", status: 503 } });
  });
  it("checks ownership before reading/writing claims or invoking the provider", async () => {
    const f = setup(); f.user.rpc = async () => false; const write = vi.spyOn(f.server, "insert"), read = vi.spyOn(f.user, "select"), generate = vi.fn();
    await expect(f.instance().run(f.identity, Result, generate)).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
    expect(write).not.toHaveBeenCalled(); expect(read).not.toHaveBeenCalled(); expect(generate).not.toHaveBeenCalled();
  });
  it("does not accept another business's result even if a transport incorrectly returns it", async () => {
    const f = setup(); await f.instance().run(f.identity, Result, async () => ({ text: "Owner only" }));
    f.user.select = async () => f.rows;
    await expect(generationClaims(f.user, () => f.server, randomUUID(), f.now, f.ownerUserId, f.quotaEnv).run(f.identity, Result, vi.fn())).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });
  it("rejects a Memory request UUID in place of its canonical source key", async () => {
    const f = setup(); await expect(f.instance().run({ ...f.identity, type: "memory" }, Result, vi.fn())).rejects.toBeInstanceOf(z.ZodError); expect(f.rows).toHaveLength(0);
  });
  it("accepts the bounded canonical Memory key without relaxing Blueprint/Evaluation UUID keys", async () => {
    const f = setup(), key = `memory:${randomUUID()}:2147483647`, generate = vi.fn(async () => ({ text: "Canonical" }));
    expect(key).toHaveLength(54);
    await f.instance().run({ ...f.identity, type: "memory", requestKey: key }, Result, generate);
    await expect(f.instance().run({ ...f.identity, requestKey: key }, Result, generate)).rejects.toBeInstanceOf(z.ZodError);
    for (const invalid of [key.replace(/2147483647$/, "2147483648"), key.replace(/2147483647$/, "01"), key.replace(/2147483647$/, "0"), "memory:not-a-uuid:1"]) {
      await expect(f.instance().run({ ...f.identity, type: "memory", requestKey: invalid }, Result, generate)).rejects.toBeInstanceOf(z.ZodError);
    }
    expect(generate).toHaveBeenCalledTimes(1);
  });
  it("records an aborted request without automatically invoking the provider again", async () => {
    const f = setup(), generate = vi.fn(async () => { throw new DOMException("Aborted", "AbortError"); });
    await expect(f.instance().run(f.identity, Result, generate)).rejects.toMatchObject({ name: "AbortError" });
    await expect(f.instance().run(f.identity, Result, generate)).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" }); expect(generate).toHaveBeenCalledTimes(1);
  });
  it("fails closed without a quota key for fresh work but still replays a stored result", async () => {
    const f = setup(), generate = vi.fn(async () => ({ text: "Stored" }));
    await f.instance().run(f.identity, Result, generate);
    const unavailable = generationClaims(f.user, () => f.server, f.businessId, f.now, f.ownerUserId, {});
    expect(await unavailable.run(f.identity, Result, generate)).toEqual({ text: "Stored" });
    await expect(unavailable.run({ ...f.identity, requestKey: randomUUID() }, Result, generate)).rejects.toMatchObject({ code: "AI_QUOTA_CONFIGURATION_REQUIRED", status: 503 });
    expect(generate).toHaveBeenCalledTimes(1);
  });
  it("keeps the same request key independent across authenticated businesses", async () => {
    const f = setup(), otherBusiness = randomUUID(), generate = vi.fn(async () => ({ text: "Own result" }));
    await Promise.all([f.instance().run(f.identity, Result, generate), generationClaims(f.user, () => f.server, otherBusiness, f.now, f.ownerUserId, f.quotaEnv).run(f.identity, Result, generate)]);
    expect(generate).toHaveBeenCalledTimes(2); expect(new Set(f.rows.map(row => row.business_id)).size).toBe(2);
  });
});
