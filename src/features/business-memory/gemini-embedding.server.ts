import "server-only";
import { geminiFetch } from "@/lib/ai/gemini-fetch.server";
import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { MemoryError } from "./contracts";
import { EmbeddingTextSchema, embeddingProfile, normalizeEmbedding, type EmbeddingProvider } from "./embedding";
const Config = z.object({ apiKey: z.string().trim().min(1), model: z.enum(["gemini-embedding-001","gemini-embedding-2"]),
  timeoutMs: z.number().int().min(100).max(20000).default(15000), maxAttempts: z.number().int().min(1).max(2).default(1) });
export function geminiEmbeddingProvider(raw: unknown): EmbeddingProvider {
  const parsed = Config.safeParse(raw); if (!parsed.success) throw new MemoryError("EMBEDDING_CONFIGURATION_REQUIRED", 503);
  const config = parsed.data; const configuration = embeddingProfile("gemini", config.model);
  return { configuration, async embed(text, purpose) {
    const input = EmbeddingTextSchema.parse(text); const deadline = Date.now() + config.timeoutMs;
    for (let attempt = 0; attempt < config.maxAttempts; attempt++) {
      const remaining = deadline - Date.now(); if (remaining <= 0) throw new MemoryError("EMBEDDING_TIMEOUT", 504);
      const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const client = new GoogleGenAI({ apiKey: config.apiKey, httpOptions: { fetch: geminiFetch } });
        const secondGeneration=config.model==="gemini-embedding-2";
        const contents=secondGeneration?(purpose==="query"?`task: search result | query: ${input}`:`title: none | text: ${input}`):input;
        const raw: unknown = await Promise.race([client.models.embedContent({ model: config.model, contents,
          config: { outputDimensionality: 768, ...(secondGeneration?{}:{taskType: purpose === "document" ? "RETRIEVAL_DOCUMENT" : "RETRIEVAL_QUERY"}),
            abortSignal: controller.signal, httpOptions: { timeout: remaining, retryOptions: { attempts: 1 } } } }),
        new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new MemoryError("EMBEDDING_TIMEOUT", 504)); }, remaining); })]);
        const response = z.object({ embeddings: z.array(z.object({ values: z.array(z.number().finite()).length(768) })).length(1) }).safeParse(raw);
        if (!response.success) throw new MemoryError("INVALID_EMBEDDING", 502);
        return normalizeEmbedding(response.data.embeddings[0].values);
      } catch (error) {
        if (error instanceof MemoryError) throw error;
        const code = z.object({ status: z.number().optional() }).safeParse(error);
        if (attempt + 1 >= config.maxAttempts || code.success && code.data.status !== undefined && ![408,429,500,502,503,504].includes(code.data.status)) throw new MemoryError("EMBEDDING_UNAVAILABLE", 503);
      } finally { if (timer) clearTimeout(timer); }
    }
    throw new MemoryError("EMBEDDING_UNAVAILABLE", 503);
  } };
}
