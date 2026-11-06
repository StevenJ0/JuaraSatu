import "server-only";
import { z } from "zod";
import { authenticateDiscussion,checkWriteOrigin } from "../campaign-strategist/discussion-auth.server";
import { readDiscussionBody,discussionApiError } from "../campaign-strategist/discussion-api.server";
import { privilegedTransport } from "@/lib/supabase/transport.server";
import { GenerateMemorySchema,ReviewMemorySchema,ApproveMemorySchema,RetrievalCommandSchema,MemoryError,type MemorySource } from "./contracts";
import { memoryDevelopmentEnabled } from "./development-provider";
import { memoryRepository,memoryDatabaseError } from "./repository.server";
import { configuredMemoryProvider } from "./gemini.server";
import { memoryService } from "./service";
import { configuredEmbedding,retrieveMemoryHistory } from "./retrieval.server";
import { runMemoryWorker } from "./indexing.server";
import { EvaluationError } from "../campaign-evaluation";
import { CampaignExecutionError } from "../campaign-execution";
import { GenerationClaimError } from "@/lib/ai/generation-claims.server";
const Action=z.discriminatedUnion("action",[GenerateMemorySchema.extend({action:z.literal("generate")}),ReviewMemorySchema.extend({action:z.literal("review")}),ApproveMemorySchema.extend({action:z.literal("approve")}),
  RetrievalCommandSchema.extend({action:z.literal("retrieve")}),z.strictObject({action:z.literal("run_worker")})]);
async function boundary(request:Request){const owner=await authenticateDiscussion(request);if(!memoryDevelopmentEnabled(process.env))throw new MemoryError("FAKE_MEMORY_DISABLED",503);
  const repository=memoryRepository(owner.user,privilegedTransport,owner);const now=()=>new Date().toISOString();
  return{owner,repository,service:memoryService(repository,{now,ownerUserId:owner.ownerUserId,provider:(scenario)=>configuredMemoryProvider(scenario,process.env),embedding:()=>configuredEmbedding(process.env).configuration,databaseError:memoryDatabaseError})};}
const respond=(body:unknown,status=200)=>Response.json(body,{status,headers:{"Cache-Control":"no-store"}});
function failure(error:unknown){if(error instanceof GenerationClaimError)return Response.json({success:false,code:error.code},{status:error.status,headers:{"Cache-Control":"no-store",...(error.retryAfter?{"Retry-After":String(error.retryAfter)}:{})}});if(error instanceof MemoryError||error instanceof EvaluationError||error instanceof CampaignExecutionError)return respond({success:false,code:error.code},error.status);if(error instanceof z.ZodError)return respond({success:false,code:"INVALID_INPUT"},400);return discussionApiError(error);}
export async function memoryGet(request:Request){try{const b=await boundary(request);const url=new URL(request.url);
  if(url.searchParams.has("memoryId"))return respond(await b.service.get(z.uuid().parse(url.searchParams.get("memoryId"))));
  if(url.searchParams.has("campaignId")){const id=z.uuid().parse(url.searchParams.get("campaignId"));const evalId=await b.repository.latestEvaluationId(id);let source:MemorySource|null=null;let sourceError:string|null=null;
    if(evalId){try{source=await b.repository.source(id,evalId);}catch(error){sourceError=error instanceof MemoryError?error.code:"SOURCE_UNAVAILABLE";}}else sourceError="EVALUATION_REQUIRED";
    return respond({source,sourceError,memories:await b.service.list(id)});}
  return respond({campaigns:await b.repository.campaigns(),memories:await b.service.list(),synthetic:true});
}catch(error){return failure(error);}}
export async function memoryPost(request:Request){try{const b=await boundary(request);checkWriteOrigin(request);const{action,...body}=Action.parse(await readDiscussionBody(request));
  if(action==="generate")return respond(await b.service.generate(body));if(action==="review")return respond(await b.service.review(body));if(action==="approve")return respond(await b.service.approve(body));
  if(action==="run_worker")return respond(await runMemoryWorker(b.owner.user,privilegedTransport,b.owner,configuredEmbedding(process.env),()=>new Date().toISOString()));
  return respond({history:await retrieveMemoryHistory(b.owner.user,b.owner.businessId,body,configuredEmbedding(process.env),()=>new Date().toISOString())});
}catch(error){return failure(error);}}
