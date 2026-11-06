# Business Memory E2E - 5 November 2026

Current completion: see section G below (16 PASS). Sections A-F preserve the earlier7 PASS/9 BLOCKED baseline.

## A. Execution summary

**Final sixteen-case result: 7 PASS, 0 FAIL, 9 BLOCKED. Real Gemini Business Memory E2E is NOT VERIFIED.**

Existing local Next.js and Supabase were used. No Bruno CLI command was available. The runner reuses the installed native Bruno Desktop parser0.40.0, existing .bru definitions, Node VM pre/post scripts and assertions, and actual authenticated local HTTP. It is a compatibility harness, not an assertion that Bruno CLI/GUI executed the workflow.

Current run: 5d8550b8-a967-4902-8d27-1338460a5123, 5/11/2026, 21.41.11 WIB. Campaign c8f2a641-9b73-4e02-a7d5-61c90b38f254 is completed v10.

| Test | Scenario | Result | HTTP | Evidence |
| --- | --- | --- | --- | --- |
| 01 | Source discovery | PASS | 200 | Completed owned campaign listed |
| 02 | Current final Evaluation handoff | PASS | 200 | Latest final source and synthetic restrictions verified |
| 03 | Reject failure injection (real-mode guard) | PASS | 400 | FAKE_SCENARIO_DISABLED; no candidate/inference |
| 04 | Reject invalid injection (real-mode guard) | PASS | 400 | FAKE_SCENARIO_DISABLED; no candidate/inference |
| 05 | Reject missing-evidence injection (real-mode guard) | PASS | 400 | FAKE_SCENARIO_DISABLED; no candidate/inference |
| 06 | Generate persisted draft | BLOCKED | - | Specific live authorization/no-billing eligibility unavailable |
| 07 | Replay generation | BLOCKED | - | No generated candidate/original memoryBody |
| 08 | Read draft/index status | BLOCKED | - | No persisted candidate |
| 09 | Owner review | BLOCKED | - | No persisted candidate |
| 10 | Reject candidate | BLOCKED | - | No persisted candidate |
| 11 | Review again | BLOCKED | - | No persisted candidate |
| 12 | Reload reviewed candidate | BLOCKED | - | No persisted candidate |
| 13 | Reject synthetic approval | BLOCKED | - | No candidate against which to exercise approval guard |
| 14 | Scoped worker idle | PASS | 200 | HTTP200 idle, claimed0; no job/provider |
| 15 | Historical retrieval cold-start | PASS | 200 | HTTP200 cold_start; no query embedding |
| 16 | Final candidate reload | BLOCKED | - | No persisted candidate |

Cases03-05 in real mode verify **disabled Fake-scenario injection**, not simulated upstream503 or invalid real model output. Those model-failure paths are covered separately by regression mocks. No failed/invalid provider response is fabricated to claim real E2E success.

Six additional actual HTTP checks passed, separately from the sixteen-case counts:
- Unauthenticated source access401.
- Foreign-owner source read404.
- Foreign-owner generation request404 before inference.
- Stale source hash409 STALE_MEMORY_SOURCE before inference.
- Supplied businessId cannot override worker scope:400 INVALID_INPUT.
- Historical failed Evaluation cannot become the current source:409 STALE_MEMORY_SOURCE.

Successful scenario execution took 270.2-355.55 ms per runner step. This includes scripts/HTTP/PostgreSQL assertions, not pure server latency. No inference latency was measured.

## B. Gemini provider verification

| Category | Actual execution |
| --- | --- |
| Newly executed real Memory generation | **0**; case06 blocked |
| Newly executed real embedding/query embedding | **0**; worker idle and retrieval cold-start returned before embedding |
| Existing provider results used | Cases01-02 read/revalidate the persisted final Evaluation whose provider metadata is gemini |
| Actual HTTP with no AI request | Cases01-05,14-15 and six extra authorization/source checks |
| Mock/Fake providers | Only separately reported automated regression fixtures/HTTP mocks; never inserted as live-run Memory evidence |
| Dependent cases not executed |06-13 and16 have explicit BLOCKED results |
| Automatic retries/fallback | None used |

Provider settings were inspected without exposing key values: CAMPAIGN_MEMORY_PROVIDER=gemini, CAMPAIGN_MEMORY_RETRIEVAL=gemini, text model gemini-3.6-flash and embedding model gemini-embedding-2. Negative responses400 FAKE_SCENARIO_DISABLED are consistent with the actual real-provider factory rejecting non-neutral scenarios before SDK creation.

A specific new live Memory request was not authorized in this task and no independently verified no-billing evidence was available. Previous Evaluation authorization is not reused. API key presence, model names and historical HTTP200 are not billing proof. The runner has **no live-generation branch**.

The collection's allowPaidRequests flag is enabled inside the compatibility context only for the five independently checked zero-inference actions03-05/14-15. It is a client guard opt-in, not authorization to incur costs. Before HTTP dispatch the runner additionally enforces noInferencePolicy and fresh SQL checks: known non-neutral generation scenarios only while no candidate exists; worker only with no Memory rows/jobs; retrieval only with no Memory rows. Valid generation stays BLOCKED even if that client flag is true. The global collection guard is unchanged.

## C. Persistence, identity and safety verification

The actual latest final Evaluation is **a81c3363-305d-4cfc-af6c-51b212bf904b**, not the pre-finalization review ID7d02ca11-a1e5-4e2a-af61-345df2056b90. PostgreSQL confirms final/available/reviewed/provider gemini and development_synthetic completion, linked to that reviewed parent.

The API handoff preserves:
- evaluationId a81c3363-305d-4cfc-af6c-51b212bf904b.
- sourceVersion10 and current owned campaign binding.
- contextHash5e3d8e3af50a3b123b494e2815591960da1f334849819ff98d61b2d4c837033c.
- synthetic:true, productionEligible:false, developmentEligible:true.
- results.provisional:true and visible limitations.

The completion adapter revalidates evaluationHandoff, source versions/current hash, reviewed final audit and recalculated financial facts. No historical Evaluation was rewritten.

**Memory candidate identity/revision chain/review transitions: BLOCKED in actual persistence**, because there are zero candidates. Draft generation cannot be substituted with copied Evaluation prose or a Fake interpretation. Mocked SDK/workflow tests cover candidate insertion, nullable Google ID, canonical replay, content-hash CAS, review/reject/re-review and synthetic approval refusal.

The current contract stores the latest ownerReview decision/actor/time/request/expected hash in lessons_json; it does not implement an immutable ledger of every past candidate-text/review revision. No new version counter, history table or migration was fabricated.

Actual PostgreSQL catalog checks:
- campaign_memories RLS enabled; authenticated owner_read SELECT policy exists.
- synthetic_finalization_guard, memory_guard and memory_pipeline_guard enabled.
- approve_campaign_memory EXECUTE: anon false, authenticated false, service_role true.
- claim_memory_jobs EXECUTE: authenticated false, service_role true.

These catalog checks and source-level HTTP isolation **do not replace case13's unexecuted rejection against a persisted candidate**, nor prove per-Memory-row RLS with a populated candidate. Safety/isolation is verified only for the executed source/strict-scope/idle/cold-start boundaries plus separately mocked guards. Full candidate lifecycle and production retrieval remain unverified.

## D. Failures and fixes

The first actual runner execution produced4 PASS,3 FAIL,9 BLOCKED. Cases03-05 expected Fake-only503/502, while the configured Gemini factory correctly returned400 FAKE_SCENARIO_DISABLED. Initial red results are preserved in the timestamped run JSON files.

The request bodies contain scenario failure/invalid/missing_evidence against the same valid final source. They are Memory provider-injection selectors, **not three distinct failed Evaluation source records**. Production code explicitly disables those selectors in real mode.

Minimal corrections:
- 03-Reject-failure-candidate.bru,04-Reject-invalid-candidate.bru,05-Reject-missing_evidence-candidate.bru: provider-mode-specific strict status/code assertions. Real mode requires exactly400/FAKE_SCENARIO_DISABLED; test-only Fake mode retains exactly503/MEMORY_PROVIDER_UNAVAILABLE or502/INVALID_MEMORY_OUTPUT. Unexpected200, wrong status or wrong code still fails. Docs state the distinct coverage.
- 06-Generate-persisted-draft.bru: client timeout90 seconds rather than30, matching an observation window beyond the existing60-second provider deadline. This does not extend server execution or authorize a call.
- 14/15 docs: describe the precise zero-inference preflight required in real mode instead of claiming the actions inherently require Fake or are always free.
-New scripts/test-business-memory-e2e.mjs: small scoped runner based on existing parser/VM/auth patterns; clears stale runtime variables, executes ordered scripts, guards provider-capable actions, saves all sixteen outcomes and before/after SQL hashes. Credentials stay in memory.
-New tests/unit/business-memory-bruno.test.ts:21 cases verify strict assertions in both modes, SDK-free rejection, hard no-inference policy, variable/UUID resolution and original-body replay preservation.

No backend/provider/auth/domain/financial/RLS implementation, environment, model, dependency, database schema or migration was modified. Assertions were corrected to the demonstrated configured contract; they were not relaxed to accept arbitrary failure.

### Actual request path

Bruno definition -> collection pre-request + request pre-request -> fresh no-inference preflight -> owner JWT HTTP request -> memoryGet/memoryPost -> authenticateDiscussion/Origin/Zod -> memoryService -> repository/source/domain -> response -> collection/request post-response scripts -> Bruno assertions -> SQL state comparison.

Source reads use memoryRepository.source -> latest Evaluation check -> current completed campaign/audit check -> buildEvaluationContext/evaluationCurrentHash -> memorySource/evaluationHandoff. Worker14 invokes the existing business/profile-scoped claimant and gets no jobs. Retrieval15 checks ownership and eligible metadata, then returns cold_start before query embedding.

## E. Final database state

| Item | Before | After |
| --- | --- | --- |
| Target campaign | completed v10 | completed v10 |
| Original baseline MD5 |478a55ab7790c2a1f9d5577dda74011d |Same |
| Target Evaluation records |6, immutable snapshots |Same IDs and full-row hashes |
| Target-business Memory records |0 |0 |
| Target-business jobs |0 |0 |
| Other-business Memory digest |Captured |Unchanged |

All scenario and extra-check assertions compare current campaign/Evaluation/Memory/job state with the baseline. No candidate, review, approval, vector, embedding job, artificial AI record or source attestation was created. Worker claim was idle; no unrelated job was processed.

Existing owner identities were authenticated through local Supabase admin generate_link + local verify, without email delivery, password changes or ownership changes. Authentication can create local Auth sessions; no business record was changed and no credential/token/link/email is stored in the results.

Machine-readable evidence: [latest.json](../../node_modules/.cache/business-memory-e2e/latest.json), plus run-UUID.json files in the same ignored directory. The artifact includes exact filenames, assertions, HTTP status, safe code, blockers, timings and before/after hashes without raw narrative, vectors or credentials.

## Regression commands and results

~~~text
node scripts/test-business-memory-e2e.mjs
node scripts/validate-bruno-collection.mjs
node_modules/.bin/vitest.cmd run tests/unit tests/integration/remaining-ai-contracts.test.ts tests/integration/evaluation-provider-validation.test.ts tests/integration/blueprint-provider-provenance.test.ts
node_modules/.bin/tsc.cmd --noEmit --incremental false
npm.cmd run lint
npm.cmd run build
~~~

- Actual Business Memory runner:7 PASS,0 FAIL,9 BLOCKED; six extra safe HTTP checks PASS.
- Native Bruno parser0.40.0:141 collection requests plus scripts/variables/route contracts validated.
- Automated regression: **618 tests /31 files PASS**, comprising600 unit tests +18 mocked SDK/workflow integration cases. Includes Memory domain, persistence ports, canonical concurrency, idempotency, review CAS, worker lease/fencing/recovery, retrieval/tenant boundaries and Strategist/Blueprint/Evaluation regression.
- TypeScript, ESLint and production build: **PASS**, exit0.
- The legacy tests/integration/business-memory.test.ts and memory-api.mjs setup create a Fake Evaluation/Memory workflow through application routes. They were not run against a server configured for real Gemini, since setup could consume unrelated inference and alter additional fixtures. Their historical results are not claimed as this run's results.
- No live embedding smoke, disposable database creation/reset, migration, commit, push, deploy or payment/messaging action.

## F. Remaining risks and authorization

1. **Real Gemini Business Memory E2E: BLOCKED/unverified.** One specifically authorized Memory generation and independently verified no-billing eligibility are still required. The runner intentionally cannot spend that allowance automatically.
2. Cases06-13/16 remain blocked by that missing candidate. In particular actual candidate review history, per-row foreign access, source CAS races and SQL synthetic-approval rejection were not exercised in this run.
3. Real-mode03-05 demonstrate configuration guards only; malformed/failed model outputs remain mock-only coverage. The extra historical failed-source request verifies stale-source exclusion, not a newly failed model output.
4. Worker idle and cold-start prove no work/no history in this scope. They do not verify embedding generation, positive claim/writeback, semantic relevance or retrieval from approved verified history.
5. Even a valid real-generated draft from this source must remain synthetic and production-ineligible. Approving/indexing synthetic evidence is not an authorization option.
6. Canonical database uniqueness prevents duplicate persisted candidates, but concurrent initial submissions may each invoke a provider before canonical reconciliation. Send at most one authorized live generation; no automatic retries.
7. Real model output safety and latency remain untested for Memory; deterministic prose guards are bounded pattern checks, not a universal semantic verifier.

No manual Bruno execution is required to reproduce the safe subset: run scripts/test-business-memory-e2e.mjs in the existing local environment. The detailed BLOCKED results are deliberate fail-closed outcomes, not completed lifecycle tests.

Final preservation check:123 protected application/config/schema/migration/dependency files remained byte-identical. Direct PostgreSQL snapshot comparison after all tests matched the initial campaign, six Evaluations, Memory/job state. Credential scan found no configured secret values in the changed files or machine-readable result.


## G. Controlled Real Gemini completion - CURRENT EXECUTION

**Current result:16 PASS /0 FAIL /0 BLOCKED for the sixteen-scenario synthetic workflow. Real Gemini Memory draft generation, persistence, replay and candidate lifecycle are verified. Positive production embedding/retrieval is NOT verified.**

The earlier7 PASS/9 BLOCKED section remains the historical baseline. The new explicit one-call authorization was consumed exactly once, before dispatch. No further generation allowance remains for this authorization.

Run 943b43f9-3116-4084-9a21-a16eaae2e41c at 5/11/2026, 22.33.33 WIB. Request/candidate ID **f48923d2-320d-432d-9fd9-725962fc3305**. Source Evaluation **a81c3363-305d-4cfc-af6c-51b212bf904b**, completed source version10 and unchanged context hash5e3d8e3af50a3b123b494e2815591960da1f334849819ff98d61b2d4c837033c.

### G.A Test matrix

| Test | Scenario | Previous | Current | HTTP | Evidence |
| --- | --- | --- | --- | --- | --- |
| 01 | Source discovery | PASS | PASS | 200 | Owned completed source listed |
| 02 | Final Evaluation handoff | PASS | PASS | 200 | Current final source/flags preserved |
| 03 | Failure injection guard | PASS | PASS | 400 | 400 FAKE_SCENARIO_DISABLED; no inference |
| 04 | Invalid injection guard | PASS | PASS | 400 | 400 FAKE_SCENARIO_DISABLED; no inference |
| 05 | Missing-evidence injection guard | PASS | PASS | 400 | 400 FAKE_SCENARIO_DISABLED; no inference |
| 06 | Generate real draft | BLOCKED | PASS | 200 | Real completed JSON accepted and persisted |
| 07 | Generation replay | BLOCKED | PASS | 200 | replayed:true; SDK count unchanged |
| 08 | Read draft/index state | BLOCKED | PASS | 200 | Canonical owned synthetic draft; no job |
| 09 | Owner review | BLOCKED | PASS | 200 | Reviewed with owner audit and fresh hash |
| 10 | Reject candidate | BLOCKED | PASS | 200 | Rejection persisted; SQL state remains draft |
| 11 | Review again | BLOCKED | PASS | 200 | Fresh-hash re-review permitted and persisted |
| 12 | Reload reviewed candidate | BLOCKED | PASS | 200 | Reviewed canonical row reloaded |
| 13 | Reject synthetic approval | BLOCKED | PASS | 409 | SYNTHETIC_MEMORY_APPROVAL_FORBIDDEN; no promotion/job |
| 14 | Scoped worker | PASS | PASS | 200 | idle/claimed0; no embedding |
| 15 | Historical retrieval | PASS | PASS | 200 | cold_start; no query embedding |
| 16 | Final reload | BLOCKED | PASS | 200 | Reviewed draft; vector/approval absent |

Cases03-05 remain real-mode rejection of Fake-injection selectors, not generated upstream/model failure simulations. Only case06 consumed new inference. Case07 sent the identical original command with the same UUID and returned replayed:true without another SDK request.

### G.B Free Tier and real-provider evidence

The user supplied project name Tugas Akhir, project ID gen-lang-client-0325429232, Free Tier / Set up billing status, and a non-secret key suffix. The suffix matched the configured key in memory. The suffix, API key, key hash, credentials and session tokens are not written into this report or the budget journal.

This is user-supplied project/tier evidence plus a local suffix match. **No programmatic key-to-project lookup or billing API attestation was performed, and the screenshot itself was not available as an image in this session.** No claim of direct screenshot inspection, invoice audit or programmatic project ownership verification is made.

The [official Gemini pricing documentation](https://ai.google.dev/gemini-api/docs/pricing?hl=en) lists standard gemini-3.6-flash text input/output under Free Tier. The configured request uses that model with no tools, no paid-tier upgrade, no model switch, no key rotation, store:false, stream:false, maxAttempts1 and SDK retries strategy none.

Observed live evidence:
- Configured provider gemini; model gemini-3.6-flash.
- **One new generation HTTP request, one SDK_REQUEST STARTED, one successful SDK completion.**
- Upstream HTTP200; interaction completed; generated JSON PARSED.
- Runtime schema/domain validation accepted the interpretation; one draft persisted through the existing application service/repository.
- providerRequestId is honestly null; generatedAt exists. No internal UUID is presented as a Google ID.
- Generation application request latency 26679.88 ms; SDK trace completion26279 ms.
- Ready-socket event11139 ms; request-sent11142 ms; first parsed response26260 ms; response complete26266 ms. Dispatch-to-ready-socket about11.12s; request-sent-to-response about15.12s. DNS/TCP/TLS are not separately identified, and remote model compute cannot be isolated from provider/network wait.
- **Zero embedding or query-embedding requests.**
- No Fake/Mock provider was substituted for this live result. Mocks remain separate regression evidence.

The durable journal is node_modules/.cache/business-memory-e2e/live-2abb12ae-8fc6-4a40-bfd0-5707f782dcc0.json. It records consumedBeforeDispatch:true, original UUID/body, source version and safe documentary evidence before the request. Atomic exclusive creation plus fsync rejects another reservation. An incomplete/ambiguous journal remains consumed; it is never automatically deleted or resent.

### G.C Candidate lifecycle and PostgreSQL verification

Candidate f48923d2-320d-432d-9fd9-725962fc3305 belongs to the authenticated business aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1 and the target campaign. It binds source Evaluation a81c3363-305d-4cfc-af6c-51b212bf904b/version10.

| Field/invariant | Verified final state |
| --- | --- |
| Provider/model | gemini /gemini-3.6-flash |
| Canonical source candidate count |1 |
| SQL review_status |draft |
| Current ownerReview decision |reviewed |
| Actual transitions |reviewed -> rejected -> reviewed |
| Audit checks |Actual owner identity matched, timestamps/request IDs present, each expected hash matched its predecessor |
| synthetic /productionEligible |true /false |
| embedding_status |queued |
| Actual embedding/vector |NULL |
| Embedding model/profile |NULL |
| approved_at /indexed_at |NULL /NULL |
| Existing/new indexing jobs |0 |
| Worker |idle, claimed0 |
| Retrieval |cold_start; candidate excluded before query embedding |

queued is the draft's existing column state, not proof of an enqueued job. No approval, vector, indexing job or verified historical source was created.

Actual transition evidence retained by the runner:
- Case9: reviewed, 2026-11-05T15:33:29.918Z, owner matched; request 6047487c-b6bf-4716-bf25-64541a34f6c0.
- Case10: rejected, 2026-11-05T15:33:30.405Z, owner matched; request bd48cafe-1bd5-4fe4-b7a2-0d895d544126.
- Case11: reviewed, 2026-11-05T15:33:30.807Z, owner matched; request 6bcc43fa-42ab-4f1f-8fc5-dffc69504cfe.

The application persists the latest review audit and current content hash. The runner's observed transition chain is not a newly implemented immutable database review-history ledger.

Seven additional post-live checks passed:
- Foreign-owner Memory GET404 NOT_FOUND.
- Foreign-owner review404 NOT_FOUND.
- Foreign-owner approval404 NOT_FOUND.
- Owner stale review hash409 MEMORY_SOURCE_CONFLICT.
- Exact review replay200/replayed:true without another write.
- Concurrent identical review replays200/replayed:true; this verifies retry reconciliation, not a new concurrent-CAS write race.
- Foreign JWT direct PostgREST SELECT returned zero rows for the populated Memory, verifying actual row isolation.

The post-live checks left candidate hash229b227e5872960c3bb7035ef65bac4b and the live journal unchanged, with no additional provider request. The earlier six source/auth checks also passed.

### G.D Runner changes and regression

Modified this execution:
1. scripts/test-business-memory-e2e.mjs: explicit --live-memory-once flag, model/tier/key-match gates, exclusive durable budget, exact original body, persistence-only recovery after an interrupted call, SDK trace accounting, scoped lifecycle assertions and zero-embedding worker/retrieval policy.
2. tests/unit/business-memory-bruno.test.ts: five new safety/budget tests. One preflight test detected that journal serialization reordered fields; reservation now preserves the exact original body and rejects unexpected generation fields.
3. This QA report: append current execution while preserving the earlier baseline.

No production source, provider/domain validator, authentication, model, environment, dependency, schema or migration changed. The original Bruno requests and scripts were reused.

~~~text
# Transient process-only key-suffix evidence was supplied without logging its value.
node scripts/test-business-memory-e2e.mjs --live-memory-once
node_modules/.bin/vitest.cmd run tests/unit tests/integration/remaining-ai-contracts.test.ts tests/integration/evaluation-provider-validation.test.ts tests/integration/blueprint-provider-provenance.test.ts
node_modules/.bin/tsc.cmd --noEmit --incremental false
npm.cmd run lint
npm.cmd run build
~~~

- Sixteen actual workflow scenarios PASS; six original extra checks and seven post-live isolation/CAS/replay checks PASS.
- **623 automated tests /31 files PASS** (605 unit +18 mocked SDK/workflow integration cases), reported independently of the live result.
- TypeScript, ESLint and production build PASS, exit0.
- Official Bruno parser0.40.0 validates the141-request collection; execution remains the native-parser/Node-VM compatibility runner, not Bruno CLI/GUI.
- No fixture-creating Fake integration setup was run against the real-provider server. No further live generation was run for benchmarking or regression.

Machine-readable artifacts in the ignored node_modules/.cache/business-memory-e2e directory:
- run-943b43f9-3116-4084-9a21-a16eaae2e41c.json /latest.json: full scenario matrix, safe provider events, lifecycle transitions and before/after snapshots.
- post-live-security.json: populated-row RLS/CAS/replay and PostgreSQL final-state verification.
- live-2abb12ae-8fc6-4a40-bfd0-5707f782dcc0.json: consumed one-shot allowance and original request, preserved after replay.
- free-tier-evidence.json: non-secret documentary project/tier context, without suffix/key.

Do not rerun the live command to seek another inference. An existing consumed journal permits only persisted-result recovery; absence of a persisted candidate blocks a second dispatch.

### G.E Final integrity and safety assessment

Campaign remains completed v10; publication baseline MD5478a55ab7790c2a1f9d5577dda74011d and all six Evaluation snapshots remain unchanged. The final Evaluation is still immutable. Exactly one authorized Memory was created and its owner-review metadata changed through the three documented transitions. Other-business Memory digest and scoped jobs remain unchanged.

| Assessment | Result |
| --- | --- |
| Real Gemini Memory draft generation |VERIFIED |
| Draft persistence |VERIFIED |
| Idempotent generation replay |VERIFIED; no extra SDK call |
| Candidate review/rejection/re-review |VERIFIED |
| Synthetic approval rejection against persisted candidate |VERIFIED;409 SYNTHETIC_MEMORY_APPROVAL_FORBIDDEN |
| Worker and retrieval restrictions |VERIFIED idle/cold-start, no embedding |
| Production semantic embedding/retrieval |UNVERIFIED; synthetic source remains ineligible |

All requested safely executable scenarios are complete; no scenario remains blocked in this controlled synthetic suite. No additional live authorization is needed to review these persisted results.

Remaining limits: billing evidence is documentary rather than a billing-API audit; the test does not prove all future requests are free. Exactly-once inference across arbitrary concurrent application clients is not a distributed guarantee; this runner enforces one dispatch for this authorization. Positive verified-source approval, embedding, relevance and production retrieval require a genuinely eligible non-synthetic source and separately authorized testing. No synthetic override, database reset, fabricated AI record, commit, push or deployment occurred.

Current-run final preservation check:123 protected application/config/schema/migration/dependency files remain unchanged. A final PostgreSQL read confirms campaign and all six Evaluation hashes unchanged, exactly one reviewed synthetic draft with the expected hash, no jobs, and no configured credential values in runner/tests/report or cached evidence.
