// Requires the local Next server and existing isolated Slice 6 preorder scenarios.
import assert from "node:assert/strict";
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { call, fixtureTokens } from "../tests/fixtures/local-campaign.mjs";
import { createEvaluationFixture } from "../tests/fixtures/local-evaluation.mjs";

const [token] = await fixtureTokens(); const path = "node_modules/.cache/campaign-evaluation/scenario.json";
const scopes = JSON.parse(readFileSync("node_modules/.cache/campaign-evaluation/preorders.json", "utf8"));
if (existsSync(path)) {
  const saved = JSON.parse(readFileSync(path, "utf8")); assert.match(saved.campaignId, /^[a-f0-9-]{36}$/);
  const read = await call(token, "evaluations", undefined, `?campaignId=${saved.campaignId}`);
  if (read.status === 200 && read.body.context.snapshot.campaign.status === "closed" && scopes.some((scope) => scope.preorderId === saved.preorderId)) { console.log("PASS existing isolated evaluation scenario reused without rewriting history"); process.exit(0); }
  writeFileSync(`${path}.previous`, JSON.stringify(saved, null, 2));
}
const f = await createEvaluationFixture(token);
mkdirSync("node_modules/.cache/campaign-evaluation", { recursive: true });
writeFileSync(path, JSON.stringify({ campaignId: f.campaignId, preorderId: f.preorderId, sessionId: f.sessionId, costId: f.costId, provenance: "development_fixture" }, null, 2));
console.log("PASS isolated closed Slice 7 campaign, partial manual checklist and reviewed synthetic recorded expense; no orders/payments or historical rewrites");
