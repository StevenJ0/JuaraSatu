import { MemoryJobSchema, MemoryError, type MemoryRow,type MemoryJob } from "./contracts";
import { validateStoredMemory,memoryJobMatches } from "./domain";
import { embedValidated, type EmbeddingProvider } from "./embedding";
export type MemoryIndexingPort = {
  readJob(id:string):Promise<unknown>; readMemory(id:string):Promise<unknown>;
  validateSource(row:MemoryRow):Promise<void>;
  complete(job:MemoryJob,row:MemoryRow,vector:number[]|null):Promise<void>;
  failed(job:MemoryJob,row:MemoryRow,code:string):Promise<void>;
};
export function memoryEmbeddingInput(row:MemoryRow) {
  const p=row.lessons_json;
  return JSON.stringify({normalization:"memory-v1-l2",objective:p.source.objective,strategy:p.source.strategy,observed:p.source.results.observed,
    reviewedSpendIdr:p.source.results.actualPromotionSpendIdr,interpretation:p.interpretation,limitations:row.limitations_json});
}
export async function indexClaimedMemoryJob(id:string,expectedAttempt:number,businessId:string,port:MemoryIndexingPort,provider:EmbeddingProvider,now:()=>string) {
  const job=MemoryJobSchema.parse(await port.readJob(id));
  function live(j:typeof job){return j.id===id&&j.business_id===businessId&&j.status==="running"&&j.attempt_count===expectedAttempt&&j.locked_until!==null&&Date.parse(j.locked_until)>Date.parse(now());}
  if(!live(job))throw new MemoryError("STALE_JOB_LEASE");
  const row=validateStoredMemory(await port.readMemory(job.entity_id));const p=provider.configuration;
  if(!memoryJobMatches(job,row))throw new MemoryError("STALE_EMBEDDING_JOB");
  try {
    if(row.business_id!==businessId||row.review_status!=="approved"||row.lessons_json.source.synthetic||!row.lessons_json.source.productionEligible||row.lessons_json.ownerReview.decision!=="reviewed")throw new MemoryError("INELIGIBLE_MEMORY");
    if(row.embedding_model!==p.model||row.embedding_profile!==p.profile||row.embedding_version!==p.version||row.embedding_status==="stale")throw new MemoryError("EMBEDDING_PROFILE_MISMATCH");
    await port.validateSource(row);let vector:number[]|null=null;
    if(row.embedding_status!=="ready"){
      vector=await embedValidated(provider,memoryEmbeddingInput(row),"document");
    }
    if(!live(MemoryJobSchema.parse(await port.readJob(id))))throw new MemoryError("STALE_JOB_LEASE");
    await port.validateSource(row);await port.complete(job,row,vector);
    return{status:"succeeded" as const,provider:p.provider,syntheticEmbedding:p.provider==="fake"};
  }catch(error){
    const code=error instanceof MemoryError?error.code:"EMBEDDING_UNAVAILABLE";
    // An ambiguous HTTP response may follow a committed transaction; reconcile before recording failure.
    const persisted=MemoryJobSchema.parse(await port.readJob(id));
    if(persisted.status==="succeeded"&&persisted.attempt_count===expectedAttempt&&memoryJobMatches(persisted,row)){
      const saved=validateStoredMemory(await port.readMemory(row.id));
      if(saved.embedding_status==="ready"&&saved.content_hash===row.content_hash&&memoryJobMatches(persisted,saved))return{status:"succeeded" as const,provider:p.provider,syntheticEmbedding:p.provider==="fake"};
    }
    if(code!=="STALE_JOB_LEASE"&&live(persisted))await port.failed(job,row,code);
    throw error;
  }
}
