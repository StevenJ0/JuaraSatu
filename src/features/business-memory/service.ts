import { fingerprint } from "../campaign-blueprint";
import { GenerateMemorySchema, ReviewMemorySchema, ApproveMemorySchema, MemoryError, MemoryPayloadSchema, MemorySourceSchema, type MemoryRow, type MemoryProvider,type MemorySource } from "./contracts";
import { generateMemoryInterpretation, validateMemoryInterpretation, memoryApproval, memoryContentHash,memoryJobMatches } from "./domain";
import type { MemoryRepository } from "./repository.server";
import type { EmbeddingProfile } from "./embedding";
export function memoryService(repository: MemoryRepository, deps: { now():string; ownerUserId:string; provider(scenario: "valid"|"invalid"|"failure"|"missing_evidence"):MemoryProvider; embedding():EmbeddingProfile; databaseError(error:unknown):never }) {
  async function view(row: MemoryRow) {
    let current:MemorySource|null = null; try { current = await repository.source(row.campaign_id,row.source_evaluation_id); } catch { /* Dated candidates remain readable after source invalidation. */ }
    const stale=!current || fingerprint(current)!==fingerprint(row.lessons_json.source);const jobs=await repository.jobs(row.id);
    const job=jobs.find(j=>memoryJobMatches(j,row))??null;
    return { row, stale, approval: memoryApproval(row,current),
      indexing:{code:row.review_status==="draft"?"APPROVED_MEMORY_REQUIRED":job?.status==="succeeded"&&row.embedding_status==="ready"?"MEMORY_INDEX_READY":job?.status==="dead"?"MEMORY_INDEX_DEAD":job?.status==="running"?"MEMORY_INDEX_RUNNING":job?"MEMORY_INDEX_QUEUED":"MEMORY_INDEX_JOB_MISSING",
        canRun:!stale&&!row.lessons_json.source.synthetic&&row.lessons_json.source.productionEligible&&row.review_status==="approved"&&!!job&&["queued","retryable_failed"].includes(job.status),job},synthetic:row.lessons_json.source.synthetic };
  }
  async function owned(id: string) { const row=await repository.get(id); if(!row)throw new MemoryError("NOT_FOUND",404); return row; }
  return { view,
    async list(campaignId?:string) { return Promise.all((await repository.list(campaignId)).map(view)); },
    async get(id:string) { return view(await owned(id)); },
    async generate(raw:unknown) {
      const command=GenerateMemorySchema.parse(raw); const source=MemorySourceSchema.parse(await repository.source(command.campaignId,command.evaluationId));
      if(source.campaignId!==command.campaignId||source.evaluationId!==command.evaluationId||source.contextHash!==command.expectedContextHash)throw new MemoryError("STALE_MEMORY_SOURCE");
      function identical(row:MemoryRow) { return row.business_id===source.businessId && row.campaign_id===source.campaignId && row.source_evaluation_id===source.evaluationId && row.source_version===source.sourceVersion && row.lessons_json.generation.scenario===command.scenario && fingerprint(row.lessons_json.source)===fingerprint(source); }
      const existing=await repository.get(command.requestId); if(existing){if(!identical(existing))throw new MemoryError("IDEMPOTENCY_CONFLICT");return {...await view(existing),replayed:true};}
      const canonical=await repository.bySource(source.evaluationId,source.sourceVersion); if(canonical){if(!identical(canonical))throw new MemoryError("IDEMPOTENCY_CONFLICT");return {...await view(canonical),replayed:true};}
      const provider=deps.provider(command.scenario);
      const payload=await repository.generations.run({type:"memory",requestKey:`memory:${source.evaluationId}:${source.sourceVersion}`,
        inputHash:fingerprint({source,scenario:command.scenario}),preorderId:source.preorderId,model:provider.kind==="gemini"?provider.model:"development-fake-memory"},MemoryPayloadSchema,async()=>{
        const {interpretation,...provenance}=await generateMemoryInterpretation(source,provider,deps.now);
        return MemoryPayloadSchema.parse({schemaVersion:1,...provenance,generation:{requestId:command.requestId,scenario:command.scenario},source,interpretation,
          ownerReview:{decision:"unreviewed",ownerUserId:null,reviewedAt:null,requestId:null,expectedContentHash:null}});
      });
      if(fingerprint(payload.source)!==fingerprint(source)||payload.generation.scenario!==command.scenario||payload.ownerReview.decision!=="unreviewed")throw new MemoryError("MEMORY_SOURCE_MISMATCH");
      const interpretation=validateMemoryInterpretation(payload.interpretation,source);
      const fresh=await repository.source(command.campaignId,command.evaluationId); if(fingerprint(fresh)!==fingerprint(source))throw new MemoryError("STALE_MEMORY_SOURCE");
      // Aliases resume the winner's candidate ID and provenance, including after a failed domain save.
      const winner=await repository.get(payload.generation.requestId);
      if(winner&&!identical(winner))throw new MemoryError("IDEMPOTENCY_CONFLICT");
      const row={id:payload.generation.requestId,business_id:source.businessId,campaign_id:source.campaignId,source_evaluation_id:source.evaluationId,source_blueprint_id:source.blueprintId,source_version:source.sourceVersion,
        summary_text:interpretation.summary,lessons_json:payload,limitations_json:source.limitations,review_status:"draft" as const,embedding_status:"queued" as const,
        embedding_model:null,embedding_profile:null,embedding_version:1,approved_at:null,indexed_at:null};
      try { return {...await view(await repository.insert({...row,content_hash:memoryContentHash(row)})),replayed:false}; }
      catch(error){const saved=await repository.bySource(source.evaluationId,source.sourceVersion);if(saved){if(!identical(saved))throw new MemoryError("IDEMPOTENCY_CONFLICT");return {...await view(saved),replayed:true};}return deps.databaseError(error);}
    },
    async review(raw:unknown) {
      const c=ReviewMemorySchema.parse(raw);const row=await owned(c.memoryId);const review=row.lessons_json.ownerReview;
      if(review.requestId===c.requestId){if(review.decision!==c.decision||review.ownerUserId!==deps.ownerUserId||review.expectedContentHash!==c.expectedContentHash)throw new MemoryError("IDEMPOTENCY_CONFLICT");return {...await view(row),replayed:true};}
      if(row.review_status!=="draft"||row.content_hash!==c.expectedContentHash)throw new MemoryError("MEMORY_SOURCE_CONFLICT");
      if((await view(row)).stale)throw new MemoryError("STALE_MEMORY_SOURCE");
      const payload=MemoryPayloadSchema.parse({...row.lessons_json,ownerReview:{decision:c.decision,ownerUserId:deps.ownerUserId,reviewedAt:deps.now(),requestId:c.requestId,expectedContentHash:c.expectedContentHash}});
      try { const changed=await repository.review(row,payload,memoryContentHash({...row,lessons_json:payload}));if(changed[0])return {...await view(changed[0]),replayed:false}; }
      catch(error){const saved=await owned(row.id);if(saved.lessons_json.ownerReview.requestId===c.requestId)return {...await view(saved),replayed:true};return deps.databaseError(error);}
      const saved=await owned(row.id);if(saved.lessons_json.ownerReview.requestId===c.requestId&&saved.lessons_json.ownerReview.decision===c.decision&&saved.lessons_json.ownerReview.expectedContentHash===c.expectedContentHash)return {...await view(saved),replayed:true};
      throw new MemoryError("MEMORY_SOURCE_CONFLICT");
    },
    async approve(raw:unknown) {
      const c=ApproveMemorySchema.parse(raw);const row=await owned(c.memoryId);if(row.content_hash!==c.expectedContentHash)throw new MemoryError("MEMORY_SOURCE_CONFLICT");
      const result=await view(row);if(!result.approval.eligible)throw new MemoryError(result.approval.blockers[0]??"VERIFIED_C6_UNAVAILABLE");
      try{const jobId=await repository.approve(row,deps.embedding());const saved=await owned(row.id);const confirmed=await view(saved);
        if(saved.review_status!=="approved"||confirmed.indexing.job?.id!==jobId)throw new MemoryError("MEMORY_PERSISTENCE_UNAVAILABLE",503);
        return{...confirmed,replayed:row.review_status==="approved"};
      }catch(error){return deps.databaseError(error);}
    },
  };
}
