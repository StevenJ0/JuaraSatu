import "server-only";
import { z } from "zod";
import type { SupabaseTransport } from "@/lib/supabase/transport.server";
import { MemoryError, MemoryJobSchema,MemoryWorkerResultSchema,type MemoryJob,type MemoryRow } from "./contracts";
import type { MemoryIndexingPort } from "./indexing";
import { indexClaimedMemoryJob } from "./indexing";
import { fingerprint } from "../campaign-blueprint";
import { memoryRepository,memoryDatabaseError } from "./repository.server";
import type { EmbeddingProvider } from "./embedding";
import { EmbeddingProfileSchema } from "./embedding";
export function memoryIndexingPort(user:SupabaseTransport,privileged:()=>SupabaseTransport,scope:{businessId:string;ownerUserId:string}):MemoryIndexingPort {
  const{businessId}=scope;const repository=memoryRepository(user,privileged,scope);
  async function commit(job:MemoryJob,row:MemoryRow,vector:number[]|null,errorCode:string|null){try{await privileged().rpc("complete_memory_index_job",{
    p_business_id:businessId,p_job_id:job.id,p_attempt_count:job.attempt_count,p_memory_id:row.id,p_content_hash:row.content_hash,p_embedding_version:row.embedding_version,
    p_model:row.embedding_model??"",p_profile:row.embedding_profile??"",...(vector?{p_embedding:JSON.stringify(vector)}:{}),...(errorCode?{p_error_code:errorCode}:{}),p_max_attempts:5});}catch(error){memoryDatabaseError(error);}}
  return {
    async readJob(id){const rows=z.array(MemoryJobSchema).max(1).parse(await user.select("job_runs",{select:"*",id:`eq.${id}`,business_id:`eq.${businessId}`,job_type:"eq.embed_memory"}));if(!rows[0])throw new MemoryError("NOT_FOUND",404);return rows[0];},
    async readMemory(id){const row=await repository.get(id);if(!row)throw new MemoryError("NOT_FOUND",404);return row;},
    async validateSource(row){const current=await repository.source(row.campaign_id,row.source_evaluation_id);if(!current.productionEligible||current.synthetic||fingerprint(current)!==fingerprint(row.lessons_json.source))throw new MemoryError("STALE_MEMORY_SOURCE");},
    complete:(job,row,vector)=>commit(job,row,vector,null),
    failed:(job,row,code)=>commit(job,row,null,code),
  };
}
export async function runMemoryWorker(user:SupabaseTransport,privileged:()=>SupabaseTransport,scope:{businessId:string;ownerUserId:string},provider:EmbeddingProvider,now:()=>string){
  if(await user.rpc("is_business_owner",{target_business_id:scope.businessId})!==true)throw new MemoryError("FORBIDDEN",403);
  let claimed:unknown;try{const p=EmbeddingProfileSchema.parse(provider.configuration);claimed=await privileged().rpc("claim_memory_jobs",{p_business_id:scope.businessId,p_model:p.model,p_profile:p.profile,p_embedding_version:p.version,p_limit:1,p_lease_seconds:60,p_max_attempts:5});}catch(error){return memoryDatabaseError(error);}
  const jobs=z.array(MemoryJobSchema).max(1).parse(claimed);const results:{jobId:string;status:"succeeded"|"failed";code:string|null}[]=[];
  const port=memoryIndexingPort(user,privileged,scope);
  for(const job of jobs){if(job.business_id!==scope.businessId)throw new MemoryError("MEMORY_JOB_BINDING_MISMATCH");try{await indexClaimedMemoryJob(job.id,job.attempt_count,scope.businessId,port,provider,now);results.push({jobId:job.id,status:"succeeded",code:null});}
    catch(error){results.push({jobId:job.id,status:"failed",code:error instanceof MemoryError?error.code:"MEMORY_PERSISTENCE_UNAVAILABLE"});}}
  return MemoryWorkerResultSchema.parse({status:jobs.length?"processed":"idle",claimed:jobs.length,succeeded:results.filter(r=>r.status==="succeeded").length,failed:results.filter(r=>r.status==="failed").length,results});
}
