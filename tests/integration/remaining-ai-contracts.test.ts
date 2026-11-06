import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
vi.mock("server-only", () => ({}));
import { memoryFixture } from "../fixtures/memory";
import { memoryService } from "../../src/features/business-memory/service";
import { configuredMemoryProvider } from "../../src/features/business-memory/gemini.server";
import { MemoryError, MemoryRowSchema, type MemoryRow } from "../../src/features/business-memory/contracts";
import { embeddingProfile } from "../../src/features/business-memory/embedding";
import { validateStoredMemory } from "../../src/features/business-memory/domain";
import type { MemoryRepository } from "../../src/features/business-memory/repository.server";
import { generationClaimFixture } from "../fixtures/generation-claims";
afterEach(() => vi.unstubAllGlobals());

it.each(["synthetic-provider-id", undefined])("integrates SDK memory generation/persistence/review with id %s and blocks synthetic approval", async id => {
  const f = await memoryFixture();
  let saved: MemoryRow | null = null;
  const insert = vi.fn(async (row: Omit<MemoryRow, "created_at" | "updated_at">) => {
    saved = validateStoredMemory({ ...row, created_at: f.now, updated_at: f.now }); return saved;
  });
  const approve = vi.fn(async () => { throw Error("Synthetic memory must never reach approval RPC"); });
  const repository: MemoryRepository = {
    generations: generationClaimFixture(f.source.businessId, () => f.now).instance(),
    source: async () => f.source, jobs: async () => [], approve, campaigns: async () => [],
    latestEvaluationId: async () => f.source.evaluationId, list: async () => saved ? [saved] : [],
    get: async memoryId => saved?.id === memoryId ? saved : null, bySource: async () => saved, insert,
    async review(row, payload, contentHash) {
      expect(saved?.content_hash).toBe(row.content_hash);
      saved = MemoryRowSchema.parse({ ...row, lessons_json: payload, content_hash: contentHash, updated_at: f.now }); return [saved];
    },
  };
  const fetcher = vi.fn<typeof fetch>(async () => Response.json({ ...(id ? { id } : {}), status: "completed",
    steps: [{ type: "model_output", content: [{ type: "text", text: JSON.stringify(f.row.lessons_json.interpretation) }] }] }));
  vi.stubGlobal("fetch", fetcher);
  const env = { NODE_ENV: "test", CAMPAIGN_MEMORY_PROVIDER: "gemini", GEMINI_API_KEY: "synthetic-no-network", GEMINI_MODEL: "gemini-3.6-flash" };
  const service = memoryService(repository, { now: () => f.now, ownerUserId: f.owner,
    provider: scenario => configuredMemoryProvider(scenario, env), embedding: () => embeddingProfile("gemini", "gemini-embedding-2"),
    databaseError(error): never { if (error instanceof MemoryError) throw error; throw new MemoryError("MEMORY_PERSISTENCE_UNAVAILABLE", 503); } });
  const command = { campaignId: f.source.campaignId, evaluationId: f.source.evaluationId, requestId: randomUUID(), expectedContextHash: f.source.contextHash };
  let generated = await service.generate(command);
  expect(generated.row.lessons_json).toMatchObject({ provider: "gemini", model: env.GEMINI_MODEL, providerRequestId: id ?? null, generatedAt: f.now,
    source: { synthetic: true, productionEligible: false }, generation: { requestId: command.requestId } });
  expect((await service.generate(command)).replayed).toBe(true); expect(insert).toHaveBeenCalledTimes(1); expect(fetcher).toHaveBeenCalledTimes(1);
  await expect(service.generate({ ...command, expectedContextHash: "0".repeat(64) })).rejects.toMatchObject({ code: "STALE_MEMORY_SOURCE" });
  for (const decision of ["reviewed", "rejected", "reviewed"] as const) {
    const review = { memoryId: generated.row.id, requestId: randomUUID(), expectedContentHash: generated.row.content_hash, decision, confirm: true };
    generated = await service.review(review); expect((await service.review(review)).replayed).toBe(true);
  }
  await expect(service.approve({ memoryId: generated.row.id, expectedContentHash: generated.row.content_hash, confirm: true }))
    .rejects.toMatchObject({ code: "SYNTHETIC_MEMORY_APPROVAL_FORBIDDEN" });
  expect(approve).not.toHaveBeenCalled(); expect((await service.get(generated.row.id)).row.lessons_json.providerRequestId).toBe(id ?? null);
});
describe("real source eligibility", () => {
  it("does not upgrade synthetic evidence when Gemini output is valid", async () => {
    const f = await memoryFixture(); expect(f.source.synthetic).toBe(true); expect(f.source.productionEligible).toBe(false);
  });
});

