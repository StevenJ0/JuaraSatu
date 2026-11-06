import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { call } from "./local-campaign.mjs";
import { createEvaluationFixture,generateEvaluationCommand } from "./local-evaluation.mjs";
export async function createMemoryFixture(token){
  const scopes=JSON.parse(readFileSync("node_modules/.cache/business-memory/preorders.json","utf8"));
  const f=await createEvaluationFixture(token,true,scopes[0]);let current=await call(token,"evaluations",undefined,`?campaignId=${f.campaignId}`);assert.equal(current.status,200);
  const generated=await call(token,"evaluations",generateEvaluationCommand(current.body));assert.equal(generated.status,200,generated.body.code);
  const review={campaignId:f.campaignId,requestId:randomUUID(),evaluationId:generated.body.latestEvaluationId,expectedCampaignVersion:generated.body.context.snapshot.campaign.version,expectedContextHash:generated.body.context.contextHash,confirm:true};
  const reviewed=await call(token,"evaluations",{action:"review",...review});assert.equal(reviewed.status,200,reviewed.body.code);
  const finalized=await call(token,"evaluations",{...review,action:"finalize",requestId:randomUUID(),evaluationId:review.requestId});assert.equal(finalized.status,200,finalized.body.code);assert.equal(finalized.body.context.snapshot.campaign.status,"completed");
  current=await call(token,"memories",undefined,`?campaignId=${f.campaignId}`);assert.equal(current.status,200,current.body.code);
  return{...f,source:current.body.source,evaluationId:current.body.source.evaluationId};
}
export function generateMemoryCommand(f,scenario="valid"){return{action:"generate",campaignId:f.campaignId,evaluationId:f.evaluationId,expectedContextHash:f.source.contextHash,requestId:randomUUID(),scenario};}
