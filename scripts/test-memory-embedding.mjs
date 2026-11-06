import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
const env=Object.fromEntries(readFileSync(".env.local","utf8").split(/\r?\n/).map(line=>{const i=line.indexOf("=");return[line.slice(0,i),line.slice(i+1)];}));
const model=process.env.GEMINI_EMBEDDING_MODEL??env.GEMINI_EMBEDDING_MODEL;
const key=process.env.GEMINI_API_KEY??env.GEMINI_API_KEY;
if(!model||!key){console.log("BLOCKED EMBEDDING_CONFIGURATION_REQUIRED: configure the intended GEMINI_EMBEDDING_MODEL and server credential; no provider request was sent.");process.exitCode=2;}
else {
  execFileSync(process.execPath,["node_modules/vitest/vitest.mjs","run","tests/provider/memory-embedding.test.ts"],{stdio:"inherit",windowsHide:true,env:{...process.env,GEMINI_EMBEDDING_MODEL:model,GEMINI_API_KEY:key,MEMORY_EMBEDDING_SMOKE:"1"}});
  const sample=JSON.parse(readFileSync("node_modules/.cache/business-memory-8b/real-embedding.json","utf8"));
  assert.equal(sample.configuration.model,model);assert.equal(sample.vector.length,768);assert.ok(sample.vector.every(v=>typeof v==="number"&&Number.isFinite(v)));
  const container="supabase_db_campaign-lab";
  assert.equal(execFileSync("docker",["inspect",container,"--format",'{{index .Config.Labels "com.supabase.cli.project"}}'],{encoding:"utf8"}).trim(),"campaign-lab");
  const result=execFileSync("docker",["exec","-i",container,"psql","-U","postgres","-d","postgres","-X","-qAt","-v","ON_ERROR_STOP=1"],{encoding:"utf8",input:`BEGIN;CREATE TEMP TABLE memory_embedding_smoke(v extensions.vector(768));INSERT INTO memory_embedding_smoke VALUES('${JSON.stringify(sample.vector)}');SELECT extensions.vector_dims(v) FROM memory_embedding_smoke;ROLLBACK;`});
  assert.equal(result.trim(),"768");console.log("PASS real normalized Gemini vector stored/read as PostgreSQL vector(768) in a rolled-back temporary table; not approval/indexing E2E");
}
