import { it,expect,vi } from "vitest";
import { mkdirSync,writeFileSync } from "node:fs";
vi.mock("server-only",()=>({}));
import { geminiEmbeddingProvider } from "../../src/features/business-memory/gemini-embedding.server";
import { EmbeddingVectorSchema } from "../../src/features/business-memory/embedding";
it.runIf(process.env.MEMORY_EMBEDDING_SMOKE==="1")("one bounded real Gemini embedding request with synthetic non-sensitive text",async()=>{
  const p=geminiEmbeddingProvider({apiKey:process.env.GEMINI_API_KEY,model:process.env.GEMINI_EMBEDDING_MODEL,timeoutMs:15000,maxAttempts:1});
  const vector=EmbeddingVectorSchema.parse(await p.embed("Synthetic preorder lesson: compare recorded promotion spending with the planned budget and review evidence limitations.","document"));
  expect(vector).toHaveLength(768);expect(Math.hypot(...vector)).toBeCloseTo(1,8);
  mkdirSync("node_modules/.cache/business-memory-8b",{recursive:true});writeFileSync("node_modules/.cache/business-memory-8b/real-embedding.json",JSON.stringify({configuration:p.configuration,vector,testedAt:new Date().toISOString(),syntheticText:true}));
  console.log(JSON.stringify({provider:p.configuration.provider,model:p.configuration.model,profile:p.configuration.profile,dimensions:768,liveProvider:true}));
},20000);
