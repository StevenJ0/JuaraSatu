import { randomUUID } from "node:crypto";
import { vi } from "vitest";
import { memoryFixture, memoryEnvironment } from "./memory";
import { generationClaimFixture } from "./generation-claims";
import { fakeMemoryProvider } from "../../src/features/business-memory/development-provider";
import { MemoryError, type MemoryRow, type MemoryProvider } from "../../src/features/business-memory/contracts";
import { validateStoredMemory } from "../../src/features/business-memory/domain";
import { memoryRepository, memoryDatabaseError } from "../../src/features/business-memory/repository.server";
import { memoryService } from "../../src/features/business-memory/service";

export function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve };
}
export async function memoryClaimSetup() {
  const f = await memoryFixture(), rows: MemoryRow[] = []; let at = Date.parse(f.now);
  const now = () => new Date(at).toISOString(), claims = generationClaimFixture(f.source.businessId, now);
  const repository = { ...memoryRepository(claims.user, () => claims.server, { businessId: f.source.businessId, ownerUserId: f.owner }),
    generations: claims.instance(), source: vi.fn(async () => structuredClone(f.source)),
    get: async (id: string) => rows.find(row => row.id === id) ?? null,
    bySource: async (id: string, version: number) => rows.find(row => row.source_evaluation_id === id && row.source_version === version) ?? null,
    jobs: vi.fn(async () => []), list: async () => rows, campaigns: async () => [], latestEvaluationId: async () => f.source.evaluationId,
    insert: vi.fn(async (raw: Omit<MemoryRow, "created_at" | "updated_at">) => {
      if (rows.some(row => row.id === raw.id || row.source_evaluation_id === raw.source_evaluation_id && row.source_version === raw.source_version)) throw new MemoryError("MEMORY_SOURCE_ALREADY_EXISTS");
      const row = validateStoredMemory({ ...raw, created_at: now(), updated_at: now() }); rows.push(row); return row;
    }),
    approve: vi.fn(async (): Promise<string> => { throw Error("Synthetic approval must never reach the repository"); }),
  };
  const output = async (source: Parameters<MemoryProvider["generate"]>[0]) => ({ interpretation: await fakeMemoryProvider("valid", memoryEnvironment).generate(source), providerRequestId: "batch03b-mocked-interaction" });
  const generate = vi.fn<MemoryProvider["generate"]>(output);
  const provider = vi.fn((): MemoryProvider => ({ kind: "gemini", model: "gemini-test", generate }));
  const embedding = vi.fn((): never => { throw Error("Generation must never construct an embedding provider"); });
  const dependencies = { now, ownerUserId: f.owner, provider, embedding, databaseError: memoryDatabaseError };
  const command = { campaignId: f.source.campaignId, evaluationId: f.source.evaluationId, requestId: randomUUID(), expectedContextHash: f.source.contextHash, scenario: "valid" as const };
  const invoke = (raw: unknown = command) => memoryService({ ...repository, generations: claims.instance() }, dependencies).generate(raw);
  return { ...f, rows, claims, repository, dependencies, command, generate, provider, embedding, output, invoke, advance(ms: number) { at += ms; } };
}
