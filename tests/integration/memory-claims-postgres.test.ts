import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
vi.mock("server-only", () => ({}));
import { postgresClaimFixture, pgConnection, heldPgInsert } from "../fixtures/postgres-generation-claims";
import { deferred } from "../fixtures/memory-claims";

const Output = z.object({ text: z.string() });
describe.skipIf(process.env.MEMORY_CLAIM_POSTGRES !== "1")("Batch 03B isolated actual local PostgreSQL claims (no real provider)", () => {
  let f: Awaited<ReturnType<typeof postgresClaimFixture>>;
  beforeAll(async () => { f = await postgresClaimFixture(); console.log(`Batch 03B fixture evidence: ${f.evidence}`); }, 30000);
  beforeEach(async () => { await f.rotateQuotaNamespace(); }, 30000);
  afterAll(async () => { if (f) await f.cleanup(); }, 30000);
  it("accepts all five generation types and rejects an unsupported type", async () => {
    for (const type of ["strategies", "discussion", "blueprint", "evaluation", "memory"]) {
      const id = randomUUID();
      await f.server.insert("ai_generations", { id, business_id: f.owners[0].business, preorder_id: f.owners[0].preorder, generation_type: type,
        request_key: id, input_hash: "a".repeat(64), model_id: "gemini-test", status: "running", started_at: f.now() });
    }
    await expect(f.server.insert("ai_generations", { business_id: f.owners[0].business, generation_type: "unsupported", request_key: randomUUID(), input_hash: "a".repeat(64), model_id: "test", status: "running", started_at: f.now() })).rejects.toMatchObject({ code: "23514" });
  });
  it("two real PostgreSQL connections contend on the unique key; loser cannot obtain a claim", async () => {
    const winner = randomUUID(), loser = randomUUID(), key = `memory:${randomUUID()}:1`, name = `batch03b-loser-${f.runId}`;
    const insert = (id: string) => `INSERT INTO public.ai_generations(id,business_id,preorder_id,generation_type,request_key,input_hash,model_id,status,started_at) VALUES('${id}','${f.owners[0].business}','${f.owners[0].preorder}','memory','${key}',repeat('a',64),'gemini-test','running',now());`;
    const held = await heldPgInsert(insert(winner), `batch03b-winner-${f.runId}`);
    const second = pgConnection(`SET application_name='${name}'; ${insert(loser)}`).catch(error => error);
    try {
      let blocked = false;
      for (let attempt = 0; attempt < 60; attempt++) {
        if (await pgConnection(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='${name}' AND wait_event_type='Lock');`) === "t") { blocked = true; break; }
        await new Promise(complete => setTimeout(complete, 25));
      }
      expect(blocked).toBe(true);
    } finally { await held.commit(); }
    expect(await second).toMatchObject({ code: "23505" });
    const rows = await f.rows(); expect(rows.filter(row => row.request_key === key).map(row => row.id)).toEqual([winner]);
  }, 15000);
  it("actual production helper + simultaneous empty reads grants one mocked provider invocation", async () => {
    const identity = f.identity(), gate = deferred<void>(), entered = deferred<void>(), reads = deferred<void>(); let initialReads = 0;
    const select = f.user.select.bind(f.user);
    const reader = { ...f.user, async select(...args: Parameters<typeof select>) { const rows = await select(...args); if (++initialReads <= 2) { if (initialReads === 2) reads.resolve(); await reads.promise; } return rows; } };
    const generate = vi.fn(async () => { entered.resolve(); await gate.promise; return { text: "One actual database winner" }; });
    const requests = [f.claims(f.owners[0], reader).run(identity, Output, generate), f.claims(f.owners[0], reader).run(identity, Output, generate)];
    const outcomes = Promise.allSettled(requests); await entered.promise;
    try { expect(await Promise.race(requests.map(request => request.catch(error => error)))).toMatchObject({ code: "GENERATION_IN_PROGRESS" }); expect(generate).toHaveBeenCalledTimes(1); }
    finally { gate.resolve(); await outcomes; }
    expect((await outcomes).map(result => result.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect(await f.claims().run(identity, Output, generate)).toEqual({ text: "One actual database winner" }); expect(generate).toHaveBeenCalledTimes(1);
  }, 15000);
  it("same-key conflicting payload hash cannot infer or overwrite the winning hash", async () => {
    const identity = f.identity(), gate = deferred<void>(), entered = deferred<void>();
    const generate = vi.fn(async () => { entered.resolve(); await gate.promise; return { text: "Original" }; });
    const first = f.claims().run(identity, Output, generate); await entered.promise;
    try {
      await expect(f.claims().run({ ...identity, inputHash: "b".repeat(64) }, Output, generate)).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
      expect(generate).toHaveBeenCalledTimes(1); expect((await f.rows()).find(row => row.request_key === identity.requestKey)).toMatchObject({ status: "running", input_hash: identity.inputHash });
    } finally { gate.resolve(); await first; }
  });
  it("different canonical keys and authenticated businesses remain independent", async () => {
    const identity = f.identity(), generate = vi.fn(async () => ({ text: "Independent" }));
    await Promise.all([f.claims().run(identity, Output, generate), f.claims(f.owners[1], f.other).run({ ...identity, preorderId: f.owners[1].preorder }, Output, generate),
      f.claims().run(f.identity(), Output, generate)]);
    expect(generate).toHaveBeenCalledTimes(3);
    expect(await f.other.select("ai_generations", { business_id: `eq.${f.owners[0].business}` })).toEqual([]);
  });
  it("winner can checkpoint; losing ID/hash and terminal running-CAS cannot overwrite or reopen it", async () => {
    const identity = f.identity(); await f.claims().run(identity, Output, async () => ({ text: "Sealed" }));
    const row = (await f.rows()).find(row => row.request_key === identity.requestKey); if (!row || typeof row.id !== "string") throw Error("Missing winner");
    const filters: Record<string, string>[] = [{ id: `eq.${randomUUID()}` }, { id: `eq.${row.id}`, input_hash: `eq.${"b".repeat(64)}` }, { id: `eq.${row.id}`, status: "eq.running" }];
    for (const query of filters) {
      expect(await f.server.update("ai_generations", { business_id: `eq.${f.owners[0].business}`, ...query }, { status: "running", output_json: null, finished_at: null })).toEqual([]);
    }
    expect((await f.rows()).find(item => item.id === row.id)).toMatchObject({ status: "success", output_json: { kind: "output", value: { text: "Sealed" } } });
  });
  it("stale retirement fences late provider checkpoint on actual PostgreSQL", async () => {
    const identity = f.identity(), entered = deferred<void>(), gate = deferred<void>(), generate = vi.fn(async () => { entered.resolve(); await gate.promise; return { text: "Late" }; });
    const first = f.claims().run(identity, Output, generate), observed = first.catch(error => error); await entered.promise; f.advance(180001);
    try { await expect(f.claims().run(identity, Output, generate)).rejects.toMatchObject({ code: "GENERATION_INTERRUPTED" }); }
    finally { gate.resolve(); }
    expect(await observed).toMatchObject({ code: "GENERATION_INTERRUPTED" }); expect(generate).toHaveBeenCalledTimes(1);
    expect((await f.rows()).find(row => row.request_key === identity.requestKey)).toMatchObject({ status: "failed", output_json: null });
  }, 15000);
  it("authenticated/anonymous principals cannot perform privileged writes or replay foreign claims", async () => {
    const identity = f.identity(), generate = vi.fn(async () => ({ text: "Owner only" })); await f.claims().run(identity, Output, generate);
    await expect(f.claims(f.owners[0], f.other).run(identity, Output, generate)).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
    expect(await f.other.select("ai_generations", { business_id: `eq.${f.owners[0].business}` })).toEqual([]);
    const insert = { business_id: f.owners[0].business, generation_type: "memory", request_key: f.identity().requestKey, input_hash: identity.inputHash, model_id: "test", status: "running", started_at: f.now() };
    for (const principal of [f.user, f.other, f.anonymous]) {
      await expect(principal.insert("ai_generations", insert)).rejects.toMatchObject({ code: "42501" });
      await expect(principal.update("ai_generations", { business_id: `eq.${f.owners[0].business}` }, { status: "running" })).rejects.toMatchObject({ code: "42501" });
    }
    await expect(f.anonymous.select("ai_generations", { business_id: `eq.${f.owners[0].business}` })).rejects.toMatchObject({ code: "42501" }); expect(generate).toHaveBeenCalledTimes(1);
  });
  it("composite preorder FK prevents a privileged claim with mismatched tenant source", async () => {
    const generate = vi.fn(async () => ({ text: "Must not infer" }));
    await expect(f.claims().run({ ...f.identity(), preorderId: f.owners[1].preorder }, Output, generate)).rejects.toMatchObject({ code: "23503" }); expect(generate).not.toHaveBeenCalled();
  });
  it("lost committed checkpoint response is reconciled through actual owner-scoped database readback", async () => {
    const identity = f.identity(), update = f.server.update.bind(f.server), generate = vi.fn(async () => ({ text: "Durable" }));
    f.server.update = async (table, query, values) => { await update(table, query, values); throw Error("Lost ACK"); };
    try { expect(await f.claims().run(identity, Output, generate)).toEqual({ text: "Durable" }); expect(await f.claims().run(identity, Output, generate)).toEqual({ text: "Durable" }); }
    finally { f.server.update = update; }
    expect(generate).toHaveBeenCalledTimes(1);
  });
});
