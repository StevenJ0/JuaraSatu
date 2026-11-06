import { randomUUID } from "node:crypto";
import { evaluationFixture,evaluationEnvironment } from "./evaluation";
import { EvaluationRowSchema } from "../../src/features/campaign-evaluation/contracts";
import { calculateEvaluation } from "../../src/features/campaign-evaluation/calculate";
import { interpretEvaluation } from "../../src/features/campaign-evaluation/engine";
import { developmentEvaluationProvider } from "../../src/features/campaign-evaluation/development-provider";
import { memorySource,memoryContentHash } from "../../src/features/business-memory/domain";
import { fakeMemoryProvider } from "../../src/features/business-memory/development-provider";
import { MemoryRowSchema } from "../../src/features/business-memory/contracts";
export const memoryEnvironment={NODE_ENV:"test",CAMPAIGN_MEMORY_PROVIDER:"fake"};
export async function memoryFixture(scenario="exceeds_target"){
  const f=await evaluationFixture(scenario);const c=f.context.snapshot.campaign;const id=randomUUID();const parent=randomUUID();const owner=randomUUID();
  const analysis=await interpretEvaluation(f.context,calculateEvaluation(f.context),developmentEvaluationProvider("valid",evaluationEnvironment));
  const evaluation=EvaluationRowSchema.parse({id,business_id:c.business_id,campaign_id:c.id,blueprint_id:f.snapshot.blueprint?.id,metrics_schema_version:1,
    metrics_json:{schemaVersion:1,context:f.context,summary:calculateEvaluation(f.context),commandHash:"a".repeat(64),parentEvaluationId:parent,sourceFactsAt:f.now,cas:{expectedEvaluationId:parent},
      finalization:{mode:"development_synthetic",requestId:id,reviewedEvaluationId:parent,expectedCampaignVersion:c.version,completedCampaignVersion:c.version+1,completedAt:f.now,actorUserId:owner,sourceContextHash:f.context.contextHash}},
    analysis_json:{...analysis,review:{status:"reviewed",reviewedByUserId:owner,reviewedAt:f.now}},limitations_json:f.context.limitations,evaluation_kind:"final",calculated_at:f.now,evaluated_at:f.now,source_ai_generation_id:null});
  const source=memorySource(evaluation,f.context.contextHash);const rowId=randomUUID();const interpretation=await fakeMemoryProvider("valid",memoryEnvironment).generate(source);
  const parsed=MemoryRowSchema.parse({id:rowId,business_id:source.businessId,campaign_id:source.campaignId,source_evaluation_id:source.evaluationId,source_blueprint_id:source.blueprintId,source_version:source.sourceVersion,
    summary_text:typeof interpretation==="object"&&interpretation!==null&&"summary"in interpretation?interpretation.summary:"",lessons_json:{schemaVersion:1,provider:"development-fake-memory",generation:{requestId:rowId,scenario:"valid"},source,interpretation,
      ownerReview:{decision:"unreviewed",ownerUserId:null,reviewedAt:null,requestId:null,expectedContentHash:null}},limitations_json:source.limitations,content_hash:"0".repeat(64),review_status:"draft",embedding_status:"queued",embedding_model:null,embedding_profile:null,embedding_version:1,approved_at:null,indexed_at:null,created_at:f.now,updated_at:f.now});
  return{...f,owner,evaluation,source,row:{...parsed,content_hash:memoryContentHash(parsed)}};
}
