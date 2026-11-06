import { it,expect,vi } from "vitest";
import { randomUUID } from "node:crypto";
vi.mock("server-only",()=>({}));
import { runMemoryWorker } from "../../src/features/business-memory/indexing.server";
import { fakeEmbeddingProvider } from "../../src/features/business-memory/embedding";
import type { SupabaseTransport } from "../../src/lib/supabase/transport.server";
import { SupabaseError } from "../../src/lib/supabase/transport.server";
import { memoryDatabaseError } from "../../src/features/business-memory/repository.server";
import { MemoryWorkerResultSchema } from "../../src/features/business-memory/contracts";

const scope={businessId:randomUUID(),ownerUserId:randomUUID()};
function transport(){return{rpc:vi.fn(async():Promise<unknown>=>[]),select:vi.fn(async()=>[]),insert:vi.fn(async()=>[]),update:vi.fn(async()=>[])}satisfies SupabaseTransport;}
it("checks owner authorization before invoking any privileged claimant",async()=>{const user=transport();user.rpc.mockResolvedValue(false);const privileged=vi.fn(()=>transport());await expect(runMemoryWorker(user,privileged,scope,fakeEmbeddingProvider(true),()=>new Date().toISOString())).rejects.toMatchObject({code:"FORBIDDEN"});expect(privileged).not.toHaveBeenCalled();});
it("claims only one compatible owned memory job and reports idle without provider calls",async()=>{const user=transport();user.rpc.mockResolvedValue(true);const server=transport();const provider=fakeEmbeddingProvider(true);const embed=vi.fn(provider.embed);
 const r=await runMemoryWorker(user,()=>server,scope,{...provider,embed},()=>new Date().toISOString());expect(r).toMatchObject({status:"idle",claimed:0,succeeded:0,failed:0,results:[]});expect(embed).not.toHaveBeenCalled();expect(server.rpc).toHaveBeenCalledWith("claim_memory_jobs",{p_business_id:scope.businessId,p_model:provider.configuration.model,p_profile:provider.configuration.profile,p_embedding_version:1,p_limit:1,p_lease_seconds:60,p_max_attempts:5});});
it("rejects a foreign job at the runtime boundary",async()=>{const user=transport();user.rpc.mockResolvedValue(true);const server=transport();server.rpc.mockResolvedValue([{id:randomUUID(),job_type:"embed_memory",entity_id:randomUUID(),business_id:randomUUID(),dedupe_key:"[]",status:"running",attempt_count:1,locked_until:"2026-11-04T15:00:00Z",next_run_at:"2026-11-04T01:00:00Z",last_error_code:null}]);await expect(runMemoryWorker(user,()=>server,scope,fakeEmbeddingProvider(true),()=>new Date().toISOString())).rejects.toMatchObject({code:"MEMORY_JOB_BINDING_MISMATCH"});});
it("validates worker result consistency instead of equating idle with success",()=>{expect(MemoryWorkerResultSchema.safeParse({status:"idle",claimed:1,succeeded:1,failed:0,results:[]}).success).toBe(false);});
it.each(["STALE_JOB_LEASE","STALE_MEMORY_SOURCE","STALE_EMBEDDING_JOB"])("maps SQL %s to a safe conflict",detail=>{expect(()=>memoryDatabaseError(new SupabaseError("40001",detail,409))).toThrow(detail);});
it("does not normalize arbitrary transaction failures as success",()=>{expect(()=>memoryDatabaseError(new SupabaseError("40P01","private database message",500))).toThrow("DATABASE_BUSY");});
