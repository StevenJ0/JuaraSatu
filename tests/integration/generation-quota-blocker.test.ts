import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
vi.mock("server-only", () => ({}));
import { generationClaimFixture } from "../fixtures/generation-claims";
import { memoryClaimSetup } from "../fixtures/memory-claims";
const Result = z.object({ text: z.string() });
describe("F06 admitted provider attempts", () => {
  it("shared generation boundary must cap distinct module requests at6 per minute", async () => {
    const f = generationClaimFixture(randomUUID(), () => "2026-11-06T03:00:00Z"), generate = vi.fn(async () => ({ text: "Mock only" }));
    const types = ["blueprint", "evaluation", "memory", "blueprint", "evaluation", "memory", "blueprint"] as const;
    const outcomes = await Promise.allSettled(types.map(type => f.instance().run({ type, requestKey: type === "memory" ? `memory:${randomUUID()}:1` : randomUUID(),
      inputHash: "a".repeat(64), preorderId: randomUUID(), model: "gemini-test" }, Result, generate)));
    expect(generate).toHaveBeenCalledTimes(6); expect(outcomes.filter(outcome => outcome.status === "fulfilled")).toHaveLength(6);
    expect(outcomes.filter(outcome => outcome.status === "rejected")).toMatchObject([{ reason: { code: "AI_RATE_LIMIT_EXCEEDED", status: 429 } }]);
    expect([...f.buckets.values()]).toEqual([6, 6, 6]); expect(f.rows).toHaveLength(6);
  });
  it("actual Memory service must reject its seventh distinct eligible canonical source", async () => {
    const f = await memoryClaimSetup(), errors: unknown[] = [];
    for (let index = 0; index < 7; index++) {
      const source = { ...f.source, evaluationId: randomUUID() }; f.repository.source.mockResolvedValue(source);
      await f.invoke({ ...f.command, evaluationId: source.evaluationId, requestId: randomUUID() }).catch((error: unknown) => { errors.push(error); });
    }
    expect(f.generate).toHaveBeenCalledTimes(6); expect(f.rows).toHaveLength(6);
    expect(errors).toMatchObject([{ code: "AI_RATE_LIMIT_EXCEEDED", status: 429 }]);
    expect([...f.claims.buckets.values()]).toEqual([6, 6, 6]);
  });
  it("canonical Memory alias and completed replay spend only one allowance", async () => {
    const f = await memoryClaimSetup();
    const first = await f.invoke();
    expect((await f.invoke({ ...f.command, requestId: randomUUID() })).row.id).toBe(first.row.id);
    expect((await f.invoke()).row.id).toBe(first.row.id);
    expect(f.generate).toHaveBeenCalledTimes(1);
    expect([...f.claims.buckets.values()]).toEqual([1, 1, 1]);
  });
});
