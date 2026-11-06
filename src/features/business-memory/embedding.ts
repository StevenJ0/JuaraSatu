import { createHash } from "node:crypto";
import { z } from "zod";
import { MemoryError } from "./contracts";
export const EmbeddingProfileSchema = z.object({ provider: z.enum(["fake", "gemini"]), model: z.string().regex(/^[a-zA-Z0-9/._-]{1,128}$/),
  profile: z.string().min(1).max(128), dimensions: z.literal(768), version: z.literal(1), normalization: z.literal("memory-v1-l2") });
export type EmbeddingProfile = z.infer<typeof EmbeddingProfileSchema>;
export type EmbeddingProvider = { configuration: EmbeddingProfile; embed(text: string, purpose: "document" | "query"): Promise<unknown> };
export const EmbeddingVectorSchema = z.array(z.number().finite()).length(768).refine((v) => v.some((n) => n !== 0), "Zero vector is invalid");
export const EmbeddingTextSchema = z.string().trim().min(1).max(10000);
export function normalizeEmbedding(raw: unknown): number[] {
  const vector = EmbeddingVectorSchema.parse(raw); const norm = Math.hypot(...vector);
  if (!Number.isFinite(norm) || norm === 0) throw new MemoryError("INVALID_EMBEDDING", 502);
  return vector.map((value) => value / norm);
}
export function embeddingProfile(provider: "fake" | "gemini", model: string): EmbeddingProfile {
  return EmbeddingProfileSchema.parse({ provider, model, profile: `campaign-memory-${provider}-retrieval-768-v1-l2`, dimensions: 768, version: 1, normalization: "memory-v1-l2" });
}
export function fakeEmbeddingProvider(enabled: boolean): EmbeddingProvider {
  if (!enabled) throw new MemoryError("FAKE_EMBEDDING_DISABLED", 503);
  return { configuration: embeddingProfile("fake", "development-hash-embedding-v1"), async embed(raw) {
    const text = EmbeddingTextSchema.parse(raw).normalize("NFKC").toLocaleLowerCase("id-ID"); const vector = Array.from({ length: 768 }, () => 0);
    for (const token of text.split(/[^\p{L}\p{N}]+/u).filter(Boolean)) {
      const digest = createHash("sha256").update(token).digest(); vector[digest.readUInt32BE(0) % 768] += digest[4] % 2 ? 1 : -1;
    }
    if (Math.hypot(...vector) === 0) vector[0] = 1;
    return normalizeEmbedding(vector);
  } };
}
export async function embedValidated(provider: EmbeddingProvider, text: string, purpose: "document" | "query") {
  EmbeddingProfileSchema.parse(provider.configuration);
  try { return normalizeEmbedding(await provider.embed(EmbeddingTextSchema.parse(text), purpose)); }
  catch (error) { if (error instanceof MemoryError) throw error; throw new MemoryError("EMBEDDING_UNAVAILABLE", 503); }
}
