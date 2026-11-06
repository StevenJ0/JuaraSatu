import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { memoryClaimSetup, deferred } from "../fixtures/memory-claims";
import { MemoryError } from "../../src/features/business-memory/contracts";
import { memoryService } from "../../src/features/business-memory/service";

async function held() {
  const f = await memoryClaimSetup(), entered = deferred<void>(), gate = deferred<void>();
  f.generate.mockImplementation(async source => { entered.resolve(); await gate.promise; return f.output(source); });
  const first = f.invoke(), observed = first.catch(error => error); await entered.promise;
  return { ...f, first, observed, release: () => gate.resolve() };
}
describe("Batch 03B Memory canonical durable claim, mocked provider and SQL transport", () => {
  it.each([false, true])("same canonical source, requestId alias=%s invokes once before persistence", async alias => {
    const f = await held();
    try {
      await expect(f.invoke({ ...f.command, requestId: alias ? randomUUID() : f.command.requestId })).rejects.toMatchObject({ code: "GENERATION_IN_PROGRESS", status: 409 });
      expect(f.generate).toHaveBeenCalledTimes(1); expect(f.rows).toHaveLength(0);
      expect(f.claims.rows[0].request_key).toBe(`memory:${f.source.evaluationId}:${f.source.sourceVersion}`);
    } finally { f.release(); await f.first; }
    const result = await f.invoke({ ...f.command, requestId: randomUUID() });
    expect(result.replayed).toBe(true); expect(result.row.id).toBe(f.command.requestId); expect(f.rows).toHaveLength(1);
    expect(result.row.lessons_json).toMatchObject({ provider: "gemini", model: "gemini-test", providerRequestId: "batch03b-mocked-interaction", source: { synthetic: true, productionEligible: false } });
    expect((await f.invoke()).row).toEqual(result.row); expect(f.generate).toHaveBeenCalledTimes(1); expect(f.embedding).not.toHaveBeenCalled();
    expect(f.claims.rows).toHaveLength(1); expect(result.indexing.job).toBeNull(); expect(result.indexing.canRun).toBe(false);
  });
  it.each(["scenario", "fingerprint"])("rejects an active conflicting %s without touching the winner", async change => {
    const f = await held(), originalHash = f.claims.rows[0].input_hash;
    try {
      if (change === "fingerprint") f.repository.source.mockResolvedValue({ ...f.source, objective: "Sumber berubah" });
      await expect(f.invoke({ ...f.command, requestId: randomUUID(), scenario: change === "scenario" ? "invalid" : "valid" })).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
      expect(f.claims.rows[0]).toMatchObject({ status: "running", input_hash: originalHash }); expect(f.generate).toHaveBeenCalledTimes(1);
    } finally { f.repository.source.mockResolvedValue(f.source); f.release(); await f.first; }
  });
  it("keeps independent eligible canonical sources independent", async () => {
    const f = await memoryClaimSetup(), second = { ...f.source, evaluationId: randomUUID() };
    f.repository.source.mockImplementation(async () => second);
    await f.invoke({ ...f.command, evaluationId: second.evaluationId });
    f.repository.source.mockResolvedValue(f.source); await f.invoke({ ...f.command, requestId: randomUUID() });
    expect(f.generate).toHaveBeenCalledTimes(2); expect(f.rows).toHaveLength(2); expect(f.claims.rows).toHaveLength(2);
  });
  it.each(["provider", "invalid", "unsafe", "abort"])("terminal %s failure never persists or reinfers on alias retry", async mode => {
    const f = await memoryClaimSetup();
    f.generate.mockImplementation(async () => {
      if (mode === "provider") throw new MemoryError("PROVIDER_TIMEOUT", 504);
      if (mode === "abort") throw new DOMException("Interrupted", "AbortError");
      return { interpretation: mode === "invalid" ? {} : { ...f.row.lessons_json.interpretation, summary: "Penjualan dijamin meningkat 999 unit" }, providerRequestId: null };
    });
    const code = mode === "invalid" ? "INVALID_MEMORY_OUTPUT" : mode === "unsafe" ? "UNSAFE_MEMORY_TEXT" : "MEMORY_PROVIDER_UNAVAILABLE";
    await expect(f.invoke()).rejects.toMatchObject({ code });
    await expect(f.invoke({ ...f.command, requestId: randomUUID() })).rejects.toMatchObject({ code });
    expect(f.generate).toHaveBeenCalledTimes(1); expect(f.rows).toHaveLength(0); expect(f.claims.rows[0].status).toBe("failed"); expect(f.embedding).not.toHaveBeenCalled();
  });
  it("recovers a committed checkpoint with lost acknowledgement, preserving provenance", async () => {
    const f = await memoryClaimSetup(), update = f.claims.server.update.bind(f.claims.server);
    f.claims.server.update = async (table, query, values) => { await update(table, query, values); throw Error("Lost checkpoint acknowledgement"); };
    const result = await f.invoke(); expect(result.row.id).toBe(f.command.requestId);
    expect((await f.invoke({ ...f.command, requestId: randomUUID() })).row.lessons_json.providerRequestId).toBe("batch03b-mocked-interaction"); expect(f.generate).toHaveBeenCalledTimes(1);
  });
  it("an alias resumes the winner's checkpoint after domain persistence failure", async () => {
    const f = await memoryClaimSetup(); f.repository.insert.mockRejectedValueOnce(new MemoryError("MEMORY_PERSISTENCE_UNAVAILABLE", 503));
    await expect(f.invoke()).rejects.toMatchObject({ code: "MEMORY_PERSISTENCE_UNAVAILABLE" }); expect(f.rows).toHaveLength(0);
    expect(f.claims.rows[0].status).toBe("success");
    const result = await f.invoke({ ...f.command, requestId: randomUUID() });
    expect(result.row.id).toBe(f.command.requestId); expect(result.row.lessons_json.generation.requestId).toBe(f.command.requestId);
    expect(f.rows).toHaveLength(1); expect(f.generate).toHaveBeenCalledTimes(1);
  });
  it("reconciles a committed candidate when its persistence response is lost", async () => {
    const f = await memoryClaimSetup(), save = f.repository.insert.getMockImplementation(); if (!save) throw Error("Missing fixture save");
    f.repository.insert.mockImplementationOnce(async row => { await save(row); throw new MemoryError("MEMORY_PERSISTENCE_UNAVAILABLE", 503); });
    expect((await f.invoke()).replayed).toBe(true); expect(f.rows).toHaveLength(1); expect(f.generate).toHaveBeenCalledTimes(1);
  });
  it("retires an interrupted active claim and fences late output without starting another provider", async () => {
    const f = await held(); f.advance(180001);
    try { await expect(f.invoke({ ...f.command, requestId: randomUUID() })).rejects.toMatchObject({ code: "GENERATION_INTERRUPTED" }); }
    finally { f.release(); }
    expect(await f.observed).toMatchObject({ code: "GENERATION_INTERRUPTED" }); expect(f.rows).toHaveLength(0); expect(f.generate).toHaveBeenCalledTimes(1);
    await expect(f.invoke()).rejects.toMatchObject({ code: "GENERATION_INTERRUPTED" });
  });
  it("ambiguous INSERT acknowledgement never authorizes inference", async () => {
    const f = await memoryClaimSetup(), rpc = f.claims.server.rpc.bind(f.claims.server);
    f.claims.server.rpc = async (name, values) => { await rpc(name, values); throw Error("Lost admission acknowledgement"); };
    await expect(f.invoke()).rejects.toMatchObject({ code: "GENERATION_IN_PROGRESS" }); f.advance(180001);
    await expect(f.invoke({ ...f.command, requestId: randomUUID() })).rejects.toMatchObject({ code: "GENERATION_INTERRUPTED" }); expect(f.generate).not.toHaveBeenCalled();
  });
  it.each(["contextHash", "sourceVersion", "latest"])("changed %s during inference cannot persist a candidate", async field => {
    const f = await held();
    if (field === "latest") f.repository.source.mockRejectedValue(new MemoryError("STALE_MEMORY_SOURCE"));
    else f.repository.source.mockResolvedValue({ ...f.source, [field]: field === "contextHash" ? "b".repeat(64) : f.source.sourceVersion + 1 });
    f.release(); expect(await f.observed).toMatchObject({ code: "STALE_MEMORY_SOURCE" }); expect(f.rows).toHaveLength(0);
    if (field === "sourceVersion") f.repository.source.mockRejectedValue(new MemoryError("STALE_MEMORY_SOURCE"));
    await expect(f.invoke()).rejects.toBeInstanceOf(Error); expect(f.generate).toHaveBeenCalledTimes(1);
  });
  it("revalidates source during checkpoint recovery and rejects tampered output", async () => {
    const f = await memoryClaimSetup(); f.repository.insert.mockRejectedValueOnce(new MemoryError("MEMORY_PERSISTENCE_UNAVAILABLE", 503));
    await expect(f.invoke()).rejects.toThrow();
    f.repository.source.mockResolvedValue({ ...f.source, objective: "Sumber baru" });
    await expect(f.invoke({ ...f.command, requestId: randomUUID() })).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    f.repository.source.mockResolvedValue(f.source);
    f.claims.rows[0].output_json = { kind: "output", value: { ...f.row.lessons_json, interpretation: { ...f.row.lessons_json.interpretation, summary: "Penjualan dijamin meningkat" } } };
    await expect(f.invoke()).rejects.toMatchObject({ code: "UNSAFE_MEMORY_TEXT" }); expect(f.rows).toHaveLength(0); expect(f.generate).toHaveBeenCalledTimes(1);
  });
  it("denies a foreign owner before claim read/write or provider invocation", async () => {
    const f = await memoryClaimSetup(); f.claims.user.rpc = async () => false;
    const read = vi.spyOn(f.claims.user, "select"), write = vi.spyOn(f.claims.server, "insert");
    await expect(f.invoke()).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
    expect(read).not.toHaveBeenCalled(); expect(write).not.toHaveBeenCalled(); expect(f.generate).not.toHaveBeenCalled(); expect(f.repository.insert).not.toHaveBeenCalled();
  });
  it("a foreign or ineligible source never reaches the claim/provider boundary", async () => {
    const f = await memoryClaimSetup(); f.repository.source.mockRejectedValue(new MemoryError("NOT_FOUND", 404));
    await expect(f.invoke()).rejects.toMatchObject({ code: "NOT_FOUND" }); expect(f.claims.rows).toHaveLength(0); expect(f.generate).not.toHaveBeenCalled();
  });
  it("canonical replay rejects conflicting scenarios and never creates embedding jobs or synthetic approval", async () => {
    const f = await memoryClaimSetup(), result = await f.invoke();
    await expect(f.invoke({ ...f.command, requestId: randomUUID(), scenario: "invalid" })).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    await expect(memoryService(f.repository, f.dependencies).approve({ memoryId: result.row.id, expectedContentHash: result.row.content_hash, confirm: true })).rejects.toMatchObject({ code: "SYNTHETIC_MEMORY_APPROVAL_FORBIDDEN" });
    expect(f.repository.approve).not.toHaveBeenCalled(); expect(f.embedding).not.toHaveBeenCalled(); expect(result.indexing.job).toBeNull(); expect(f.generate).toHaveBeenCalledTimes(1);
  });
});
