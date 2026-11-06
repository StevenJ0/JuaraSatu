# Remaining Campaign Lab AI modules — autonomous E2E report

5 November 2026, Asia/Jakarta. Target campaign `c8f2a641-9b73-4e02-a7d5-61c90b38f254`.
Scope completed as far as authorization, available evidence and domain guards allow. No reset, migration, commit, push, deploy, external messaging or payment calls.

Update: [Evaluation domain validator correction](EVALUATION_DOMAIN_VALIDATION.md). The report below records the earlier E2E run; corrected validator tests do not establish live acceptance.

## 1. Test Results

| Module | Test | Result | Evidence |
| --- | --- | --- | --- |
| Evaluation | Context/KPI | PASS for development simulation | Actual HTTP context; baseline paid units0; synthetic C6 development_fixture; checklist0/2; reviewed active expense subtotal8000; financial subtraction/budget variance assertions passed. Not genuine transaction KPI verification. |
| Evaluation | Real Gemini | FAIL at domain acceptance; inference executed | Two real gemini-3.6-flash calls, HTTP200/completed/JSON parsed; persisted analysis status invalid. No Fake fallback. |
| Evaluation | Persistence/replay | PASS for rejected results | Two immutable provisional records with provider gemini, model, generatedAt and providerRequestId:null. HTTP replay returned replayed:true with no additional SDK start. Payload conflict rejected409. |
| Evaluation | Expense audit | PASS | Create/replay/conflict, void/replay, replacement and completeness review via actual HTTP/PostgreSQL. Voided row preserved. |
| Evaluation | Owner review/finalization | BLOCKED | Review rejects NARRATIVE_REVIEW_UNAVAILABLE; finalization rejects OWNER_REVIEW_REQUIRED. No valid narrative to review. Campaign remains closed. |
| Evaluation | Stale/context/security | PASS for executed HTTP checks | Stale hash/version409; Fake scenario400 without inference; unauthenticated401; foreign owner404. |
| Business Memory | Real Gemini | BLOCKED, zero live calls | Adapter implemented. Source API409 ELIGIBLE_COMPLETED_EVALUATION_REQUIRED; no finalized valid Evaluation exists. |
| Business Memory | Persistence/review | PASS in SDK/workflow integration mocks; BLOCKED live | Real installed SDK with HTTP mock: valid/missing provider ID, insert/reload/hash, review/reject/review/replay; synthetic approval blocked. No live memory row created. |
| Business Memory | Embedding | PASS standalone live adapter | One explicitly authorized gemini-embedding-2 request;768 finite dimensions, L2 norm1; no memory activation or job completion claimed. |
| Business Memory | Worker/retrieval | PASS for blocked/cold-start paths | Actual scoped worker idle, retrieval cold_start, no eligible memory/no embedding jobs. Eligible historical reuse remains BLOCKED. |
| Business Memory | Isolation/security | PASS HTTP source scope + mocked contract checks; live memory-row RLS not exercised | Foreign owner cannot read target campaign source404. No live memory row exists to test per-row access. Synthetic approval remains prohibited. |

### Executed verification

- `vitest run tests/unit tests/integration/remaining-ai-contracts.test.ts tests/integration/blueprint-provider-provenance.test.ts`: **519 passed /26 files** (513 unit tests +6 mocked transport integration cases).
- Real embedding provider test: **1 passed**, test duration11.71s, total12.37s.
- TypeScript `--noEmit --incremental false`, ESLint repository-wide and Next production build: **passed**.
- Additional targeted26 tests passed after Bruno guard interpolation update.
- Actual HTTP and database assertions: [test-remaining-ai.mjs](../../scripts/test-remaining-ai.mjs). State/checkpoint evidence is ignored under `node_modules/.cache/remaining-ai-e2e/`, no credentials persisted there.
- Legacy Fake HTTP suites were not run against a real-provider server: doing so could invoke unrelated paid generation and mutate stale fixtures. Existing unit coverage was retained.

## 2. Implementation Changes

- [campaign-evaluation/gemini.server.ts](../../src/features/campaign-evaluation/gemini.server.ts): explicit configuredEvaluationProvider; shared Interactions adapter, one attempt, structured narrative schema, backend-controlled classification/reference constraints.
- [business-memory/gemini.server.ts](../../src/features/business-memory/gemini.server.ts): explicit configuredMemoryProvider; source-bound IDs/version/classifications/references, grounded interpretation and nullable Google ID.
- Evaluation and Memory contracts/engines/services: persist truthful provider/model/providerRequestId/generatedAt metadata without changing deterministic financials, review, CAS or eligibility rules. Existing Fake records remain readable; Fake generation factory is test-only.
- API boundaries now select configured real providers. Non-neutral Fake failure scenarios are rejected before inference.
- [gemini-embedding.server.ts](../../src/features/business-memory/gemini-embedding.server.ts): reuse established Gemini transport; one-attempt embedding behavior retained.
- `.env.example` and targeted local provider flags: add CAMPAIGN_EVALUATION_PROVIDER=gemini; configure Memory generation/retrieval as gemini. Model/API key/other environment values preserved.
- Bruno collection: cost opt-in covers Evaluation/Memory generation, embedding-capable actions and interpolated bodies; localhost3000/3100 supported. Existing standalone HTTP harness does not depend on manual Bruno execution.
- Development UI text no longer falsely labels all configured real generation as Fake.
- New SDK-mocked tests and [remaining-ai-contracts.test.ts](../../tests/integration/remaining-ai-contracts.test.ts) cover provider provenance, source integrity, persistence/replay, rejection/review and synthetic approval restrictions.

Provider Interaction IDs are never replaced with internal UUIDs. Internal request IDs and hashes continue to control persistence/idempotency. Metadata lives in existing JSONB fields; database schema/RLS/migrations were not changed.

### Diagnosis and fixes

Both Evaluation calls passed provider transport/envelope and JSON parsing, then were rejected by existing backend validation. Rejected prose was intentionally not persisted, and the earlier logger serialized details as {} in the Next file log, so the exact cause of those two live rejections cannot be recovered. Do not claim their specific content was known.

Safe diagnostics now serialize explicit JSON with rejection category/boolean metadata and no prose, prompts or credentials. A regression test demonstrates that the existing substring guard for pasti also rejects ketidakpastian. The new prompt avoids that substring and numeric labels in prose. The guard itself is unchanged. The wire schema now fixes classifications/references to backend evidence instead of allowing the model to choose inconsistent values. These changes pass mocks but have **not** achieved live domain acceptance.

## 3. Real Gemini Evidence

| Call | Outcome | Duration | Output acceptance |
| --- | --- | --- | --- |
| Evaluation initial | Real Gemini3.6-flash, HTTP200, completed, JSON parsed |28546 ms | invalid; record persisted as failure state |
| Evaluation additional, separately approved | Real Gemini3.6-flash, HTTP200, completed, JSON parsed |11463 ms | invalid; record persisted as failure state |
| Evaluation diagnostic third | NOT EXECUTED | — | BLOCKED by latest strict no-charge condition |
| Business Memory initial allowance | NOT EXECUTED | — | BLOCKED by source eligibility |
| Embedding, explicitly approved | Real gemini-embedding-2,768 dimensions, norm1 |11.71s test | passed; standalone probe, not activation |

Call counts: **Evaluation2, Memory0, Embedding1**. No automatic retries. The optional third Evaluation was not used: the latest instruction requires certainty of free-tier/no-charge execution; API-key metadata cannot verify current billing tier and no gcloud/billing credentials are available. Earlier free-tier/billing-disabled confirmation was the basis for previously authorized smoke calls; no current billing audit or invoice result is claimed.

Google documents a free tier for [Gemini Embedding2](https://ai.google.dev/gemini-api/docs/pricing); availability of a free tier alone does not prove which tier a particular project currently uses. No additional provider calls were made after applying the stricter condition.

Local test authentication used existing owner identities and the local Supabase admin [generateLink endpoint](https://supabase.com/docs/reference/javascript/auth-admin-generatelink), then local verification. It generated links in memory; no external email was sent, no ownership/password was changed, and tokens/links/API keys were not printed or written into reports.

## 4. Database Verification

Actual PostgreSQL checks after execution:

- Campaign remains **closed, version9**; initial version5 advanced through expense changes/completeness review. Active Blueprint remains `f3c871b2-42a6-4e9d-8b13-65d90a2f7c48`.
- Baseline checksum remains `478a55ab7790c2a1f9d5577dda74011d`; original publication baseline is unchanged.
- Expense `bd687ce7-46eb-4666-b4bf-1d4c253faabd`: amount12000, voided, version2.
- Replacement `b7c542b8-5773-411e-8415-3307a07b0259`: amount8000, active, version1.
- Costs completeness: confirmed_complete. Both descriptions clearly identify synthetic testing; no real money transfer occurred.
- Evaluation `3101ef31-50df-45d5-b012-b79c7a3ddeb1` and `4f2d7c05-c04f-4f4e-aadc-509c851dd3ba`: provisional, provider gemini, model gemini-3.6-flash, status invalid, review unreviewed, providerRequestId JSON null.
- Evaluation analytics provenance: development_fixture. Both persisted snapshots contain synthetic paidUnits12/target10; read-only SQL verified achievement/delta formulas, active spend8000 and generatedAt presence for both rows. These are simulated observations. Actual order rows for the associated preorder: **zero**.
- Live memory records for this campaign: **zero**. No source was relabelled non-synthetic and no synthetic memory was approved/indexed.
- Read-only SQL confirmed no eligible approved-ready memory or queued/retryable embedding jobs in the tested business before invoking worker/cold-start paths.

There is no production C6 transaction producer in this workflow. Creating synthetic paid-order rows would neither establish genuine customer evidence nor make this producer authoritative. No fabricated customer transactions were inserted to satisfy a success criterion.

## 5. Remaining Issues

1. **Live Evaluation domain acceptance remains FAIL.** Exact earlier prose is unavailable; safe rejection diagnostics and stricter producer constraints are now ready for a future authorized/free-tier-verifiable test.
2. **Owner review/finalization and live Memory are BLOCKED** by that valid-Evaluation prerequisite. No Fake narrative was substituted to complete the lifecycle.
3. The final optional Evaluation diagnostic is **BLOCKED by cost certainty**, not a request for a routine technical decision. No more option prompts or provider calls will be made under the current constraint.
4. **Memory production activation/reuse is BLOCKED** by synthetic evidence and missing verified C7 source attestation. Real embeddings do not change eligibility.
5. Current schemas/RPCs support existing JSONB provenance fields; no database migration was needed. Checksum comparison covered27 protected paths and552 installed dependency-version entries: database/schema/migration hashes and dependency versions remain unchanged; only the two environment files changed within that protected set. Other implementation/test/documentation changes are listed above.

Automatic approval review initially rejected the embedding command for insufficient explicit scope; it ran only after the user explicitly approved one embedding. Review also rejected a combined generation/review/finalization command because it considered lifecycle authorization insufficient. That command never ran; the separately approved generation ran alone, and no finalization was performed.

## 6. Final Verdict

- **Real Gemini integration readiness:** adapters/configuration/transport/provenance implemented and mocked regressions pass; live Evaluation interpretation acceptance remains FAIL; live Memory unverified.
- **Backend E2E readiness:** partial PASS for actual HTTP/PostgreSQL context, expense audit, rejected-result persistence/replay, security and guard paths. Full review/completion/memory path BLOCKED.
- **Real business-data readiness:** BLOCKED; observations are synthetic development fixtures, not genuine transactions.
- **Business Memory production readiness:** BLOCKED; no eligible activated memory, no verified source attestation, no live historical reuse claim.

No production-readiness claim is made from successful development fixtures or the standalone real embedding probe.

