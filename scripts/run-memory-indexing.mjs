import { call,fixtureTokens } from "../tests/fixtures/local-campaign.mjs";
import assert from "node:assert/strict";
// Explicit local owner-A fixture runner; no scheduling and no browser-visible service credential.
const [token]=await fixtureTokens();const result=await call(token,"memories",{action:"run_worker"});
assert.equal(result.status,200);assert.ok(["idle","processed"].includes(result.body.status));assert.ok(result.body.claimed<=1);
console.log(JSON.stringify(result.body));if(result.body.status==="idle")console.log("IDLE: no compatible approved memory job; synthetic drafts remain ineligible, not indexing success.");
if(result.body.failed)process.exitCode=1;
