import assert from "node:assert/strict";
import { existsSync,readFileSync,mkdirSync,writeFileSync } from "node:fs";
import { fixtureTokens,call } from "../tests/fixtures/local-campaign.mjs";
import { createMemoryFixture } from "../tests/fixtures/local-memory.mjs";
const[token]=await fixtureTokens();const path="node_modules/.cache/business-memory/scenario.json";
if(existsSync(path)){const old=JSON.parse(readFileSync(path,"utf8"));assert.match(old.campaignId,/^[a-f0-9-]{36}$/);const r=await call(token,"memories",undefined,`?campaignId=${old.campaignId}`);
  if(r.status===200&&r.body.source?.contextHash===old.contextHash){console.log(`READY http://localhost:3100/dev/memories?campaignId=${old.campaignId} (existing fixture retained)`);process.exit(0);}}
const f=await createMemoryFixture(token);mkdirSync("node_modules/.cache/business-memory",{recursive:true});writeFileSync(path,JSON.stringify({campaignId:f.campaignId,evaluationId:f.evaluationId,preorderId:f.source.preorderId,sourceVersion:f.source.sourceVersion,contextHash:f.source.contextHash,provenance:"development_synthetic"},null,2));
console.log(`READY http://localhost:3100/dev/memories?campaignId=${f.campaignId}; completed synthetic source, no candidate approval, orders or payments created`);
