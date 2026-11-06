# Slice 8 — Business Memory: implemented boundaries and handoff

Historical Slice 8 record. The later [Slice 8B handoff](SLICE_8B.md) supersedes approval/claim/writeback blockers with hardened local transactions; verified source authority and real-provider gates remain separate.

4 November 2026 (Asia/Jakarta). Local draft generation/persistence/review, provider/embedding validation, bounded context contracts and citation grounding are implemented. **Production approval, active-queue memory claiming, and verified-memory strategy retrieval remain blocked by the inspected contracts.** No schema/migration/model change, reset, remote mutation, commit, push or deployment was made.

## 1. Architecture and scope

`Completed campaign → latest reviewed final evaluation → validated C7 handoff/current source → Fake Memory interpretation → strict factual/reference/prose validation → one persisted draft → explicit owner review/rejection using content-hash CAS`.

`Eligible approved memory → scoped durable claim → embedding outside SQL → validated vector/writeback → owner-scoped compatible pgvector match → source attestation → bounded historical context → allowlisted strategy references → existing C2/Simulator financial recalculation` is the required full path. Its independent processing/query primitives are implemented and tested. The active application stops at its verified approval/claim/source-authority blockers; it does not bypass them to demonstrate this arrow sequence.

See [database gap contract](../../../docs/plans/slice-8-database-gaps.md) for the exact existing signatures and separately proposed capabilities.

## 2. Files

| Path | Responsibility |
| --- | --- |
| `contracts.ts` | Source, interpretation, payload, current owner audit, row/view, commands/job schemas and MemoryError |
| `domain.ts` | C7 source projection, deterministic assessment/reference/PII/prose guards, canonical content hash and fail-closed eligibility |
| `development-provider.ts` | Context-sensitive Fake Memory, explicit dev/test gate; valid/failure/invalid/missing-evidence cases |
| `repository.server.ts` | Owner JWT reads, actual completed-source checks, complete single INSERT and draft hash-CAS UPDATE |
| `service.ts` | Idempotent canonical creation, readback, dated-source visibility, explicit review/rejection, blocked approval |
| `embedding.ts`, `gemini-embedding.server.ts` | Distinct Fake/Gemini configurations, normalization, 768 finite nonzero vector validation, bounded real adapter |
| `indexing.ts`, `indexing.server.ts` | Processing an already claimed compatible owned job, retry/error handling, idempotent ready-result reconciliation and existing SQL write/ack adapters |
| `retrieval.server.ts` | Owner/profile-bound lookup, source attestation gate, existing SQL matching primitive, validated bounded evidence projection |
| `api.server.ts`, `index.ts` | Auth/origin/size/Zod boundaries, dev actions and public domain exports |
| `components/memory-workspace.tsx`, `components/memory.css` | Completed source, factual results, draft/provider cases, current owner review, restrictions, indexing state and retrieval state; scoped reading hierarchy and line length |
| `src/app/dev/memories/page.tsx`, `src/app/api/dev/memories/route.ts` | Development-only page and thin route |
| `src/features/ai-context/{contracts,build-business-context,context-hash,index}.ts` | Bounded available/no-match histories, scope/freshness validation and stable source hashing |
| `src/features/campaign-strategist/{contracts,prompt,strategy-service,development-provider,development-context.server,discussion-api.server}.ts` | Dynamic memory citations, prompt separation, grounded Fake explanation, common context boundary and response history metadata |
| `src/features/campaign-strategist/components/discussion-workspace.tsx` | Honest cold-start/unavailable and evidence links |
| `src/features/campaign-evaluation/components/evaluation-workspace.tsx` | Completed evaluation links to candidate UI |
| `scripts/{prepare-business-memory,run-memory-indexing,test-memory-embedding}.mjs` | Reproducible source fixture and explicit blocked worker/real-smoke diagnostics |
| `scripts/prepare-campaign-execution.mjs`, `tests/fixtures/{local-campaign,local-evaluation,local-memory}.mjs` | Existing fixture tooling extended with isolated memory/regression namespaces; no historical deadlines rewritten |
| `tests/fixtures/memory.ts`, `tests/unit/{business-memory,memory-context,memory-retrieval,gemini-memory-embedding}.test.ts` | Typed synthetic/counterfactual port fixtures and domain/provider/grounding tests |
| `tests/integration/business-memory.test.ts`, `tests/integration/memory-api.mjs`, `tests/browser/business-memory.mjs` | Actual local SQL/JWT, HTTP and Chrome tests |
| `database/v2.1/tests/memory-pipeline.mjs`, `scripts/test-database-v21.mjs` | Separate disposable lower-level vector/job pipeline and worker-claim race |
| `tests/provider/memory-embedding.test.ts` | Explicitly opted-in real-provider smoke, separate from fake/unit suites |
| `tests/integration/discussion-production.mjs` | Existing production route tests extended to memory page/API |
| Existing discussion/blueprint integration/HTTP/browser fixtures | Point to new future-valid regression preorder; all prior assertions retained |
| `.env.example`, ignored `.env.local` | Explicit Fake Memory/retrieval opt-in; no credentials/model changed |

No new dependency or SQL object was added. Existing unrelated dirty PRD/schema/package/lockfile changes were preserved. Next dev generated its own AGENTS block during startup; only that generated addition is removed before handoff.

## 3. Public contracts

Exports: `MemorySourceSchema`, `MemoryPayloadSchema`, `MemoryInterpretationSchema`, `MemoryRowSchema`, `MemoryViewSchema`, generation/review/approval/retrieval command schemas, `MemoryJobSchema`, `MemoryError`; corresponding inferred source/row/provider/interpretation/job types; `memorySource`, `validateMemoryInterpretation`, `validateStoredMemory`, `memoryContentHash`, `memoryApproval`, `generateMemoryInterpretation`, `memoryService`, embedding schemas/configuration/helpers and `indexClaimedMemoryJob`/`memoryEmbeddingInput`.

Source facts include immutable evaluation/campaign/blueprint/preorder identities, completed source revision, source hash/time, strategy/objective/window, planned-vs-observed deterministic results, actual reviewed spending/unknown values, checklist/ledger revisions, limitations and explicit synthetic/eligibility flags. Financial figures are copied from recalculated C7 results, not invented by the interpretation provider. Goal contact/credential patterns are redacted. Fake interpretation returns bounded value-free text, fixed assessment enums and exact evidence references; extra financial fields, mismatched identities/assessments, contact details, obvious instruction/causal/guarantee language are rejected. These are bounded guards, not universal natural-language proof detection.

`lessons_json` stores the versioned payload/source/interpretation/generation metadata and the **current** owner review decision/actor/time/request/expected content hash. Rejection leaves SQL review_status=draft. Immutable candidate-text revision history is unsupported; no fake source-version counter was introduced.

## 4. Database and concurrency

Reads use actual owner JWT/RLS. Writes use service role only after authenticated scope checks. A candidate is one complete INSERT, with stable request ID and the existing unique source tuple. Concurrent generation returns one persisted canonical row; provider calls are not claimed exactly once. Retry with conflicting request identity/scenario rejects.

Draft review is a single expected-hash/draft/business filtered UPDATE, with exact retry reconciliation. This is memory-row CAS. Source checks are preflight; a later source revision can make a dated draft/review stale, and cannot be treated as atomic approval. The active source adapter explicitly checks actual completed status/version/timestamp, latest final evaluation and current C7 hash, not merely JSON claims of completion. Completed Slice 7B campaign/evaluation facts are sealed by the existing SQL guards.

Existing memory approval+job enqueue is atomic, but its source checks are insufficient for enabling verified approval here. Existing global claim cannot safely serve an owner-scoped memory-only runner. The CLI returns a specific blocked result before claiming anything. The processing port can consume an already claimed owned compatible job; `complete_memory_indexing` and `finish_job` are separate idempotent operations, not an atomic lease-fenced completion. Recovered ready same-key results skip another embedding. Those limits remain visible.

## 5. Embeddings

Fake uses deterministic normalized token hashing, model `development-hash-embedding-v1`, profile `campaign-memory-fake-retrieval-768-v1-l2`, version 1. It tests contracts/plumbing, not semantic relevance.

Real adapter reads server `GEMINI_API_KEY` and explicitly selected `GEMINI_EMBEDDING_MODEL`; no model is guessed or silently switched. It supports the two inspected model interfaces, requests output dimension 768, validates exact finite/nonzero shape and L2-normalizes. Gemini 001 uses retrieval taskType; Embedding 2 uses documented query/document text prefixes and omits unsupported taskType. Configuration was checked against the installed SDK and [official Gemini documentation](https://aistudio.google.com/docs/embeddings). Provider/model and normalized profile/version are persisted by the existing approved indexing contract and must match at query time. Fake and real profiles cannot mix.

SDK retries are disabled inside the transport; the adapter owns a maximum two attempts within one bounded deadline (default one attempt), cancellation/error normalization and safe errors. No provider call occurs inside SQL.

The local environment did not specify an embedding model. The real smoke command reports `EMBEDDING_CONFIGURATION_REQUIRED` before any request. A credential alone and a previous unlabelled success are not evidence of the model used or current semantic relevance. Real embedding/real retrieval remains unverified.

## 6. Retrieval and strategist integration

Owner scope is checked before provider/matching work. SQL filters tenant, approved+ready status, model/profile/version before similarity ranking/limit. Metadata reads are business scoped and omit vectors. External rows/results are narrowed again, including identity/profile consistency and source attestation before/after matching. Unsupported/invalid data is unavailable, not fabricated history.

`cold_start`: no eligible compatible approved source. `no_match`: attested eligible sources exist but none match. `unavailable`: query/source attestation could not be completed. `available`: actual bounded eligible references. Draft/synthetic candidates never become historical evidence. Alleged verified metadata without a trusted C7 attestation reports unavailable; the active adapter intentionally has no verified authority yet.

The shared existing development context reader attaches history for all discussion/blueprint/execution callers, preventing divergent hashes. The context clock advances after retrieval so a just-read checkedAt does not appear in the future. Timestamps and changing relevance scores alone do not change hashes; memory IDs, content/source revision and profile changes do. Historical memory remains separate from authoritative current prices/capacity/KPI. At most five bounded summaries, three short lessons and five short limitations per source enter context, with source links for complete details and the existing total prompt cap.

Strategy references accept `memory:<actual retrieved UUID>`. Missing/invented sources and unsupported causal claims reject; stale/current financial guards remain. Fake Strategist can ground a cautious spending/execution explanation in actual supplied lessons, while C2/Simulator still determines prices/capacity/financial outputs. Positive grounding is tested with explicit isolated typed fixtures, not falsely approved active database records.

## 7. UI and testing boundaries

`http://localhost:3100/dev/memories` and the completed evaluation link expose draft generation, provider failure/invalid/missing-evidence, refresh, owner review/rejection, synthetic restrictions and retrieval state. Approval is visibly disabled; server and SQL independently reject it. Draft embedding_status=queued is shown with an explanation that no job exists before approval. Completed source and detailed evaluation remain linked.

Production development page/API return 404. Browser tests use actual Chrome, GoTrue cookies, real APIs/PostgreSQL and synthetic fixtures. A stale Turbopack cache initially caused HMR reload loops; the agent-owned server was restarted after archiving only generated `.next/dev`, with no source/database deletion. Browser tests are then run without blocking HMR. Screenshots are saved in ignored cache; no credentials/vectors are printed.

## 8. Verification record

| Command / suite | Actual result |
| --- | --- |
| `npm.cmd run test:unit` | 421 tests, 17 files passed; Fake providers and mocked SDK contracts, not live Gemini |
| `npx.cmd vitest run tests/integration` | 40 tests, 6 files passed against actual local Supabase; targeted 6 memory cases rerun after stale-source handling |
| `node scripts/test-supabase-v21.mjs` | 14 local integration groups passed; catalog 879 MATCH, 0 deviations |
| `node scripts/test-database-v21.mjs` | Original 100 pgTAP assertions and 3 concurrency races passed; separate disposable memory database passed 7 added SQL groups and 1 worker-claim race |
| `node tests/integration/evaluation-finalization.mjs` | 14 groups, including 12 actual PostgreSQL lock races, passed |
| HTTP scripts: discussion / blueprint / execution / evaluation / memory | 4 + 5 + 6 + 7 + 6 = 28 groups passed |
| Chrome: simulator / discussion / blueprint / execution / evaluation / memory | 7 + 8 + 8 + 9 + 12 + 9 = 53 groups passed; real login/SQL, synthetic facts and Fake providers |
| `node tests/integration/discussion-production.mjs` | All 15 development page/API method checks return 404 in the production build |
| `npm.cmd run lint`, `npx.cmd tsc --noEmit --pretty false`, `npm.cmd run build` | Passed |
| `node scripts/run-memory-indexing.mjs` | Expected blocked diagnostic, nonzero exit: `MEMORY_JOB_CLAIM_CAPABILITY_MISSING`; no job claimed |
| `node scripts/test-memory-embedding.mjs` | Expected blocked diagnostic, nonzero exit: `EMBEDDING_CONFIGURATION_REQUIRED`; no real-provider request |

Screenshots at 1440/390/320 were visually inspected; automated browser checks report no horizontal overflow. The UI detector reported no findings on the changed surfaces. A separate scoped visual review identified heading/line-length improvements; those are confined to memory-report CSS. The reviewer confirmed both fixes resolved after recapture; all nine memory browser groups, lint/typecheck/build and all 15 production checks passed again afterward. It does not constitute an independent persistence/security audit.

Real-provider and main approval/indexing successes are never inferred from fake/SQL-fixture tests. Main-stack synthetic approval rejection and no queue side effects are tested separately from disposable positive SQL plumbing. [Captured synthetic candidate](../../../docs/examples/slice-8-memory-candidate.json) is a dated local browser example, not verified business performance.

## 9. Final readiness and follow-up

See [manual QA/readiness matrix](../../../docs/qa/LOCAL_QA_SLICES_1_8.md). The separately documented C7/approval/claim/writeback/correction decisions are required before enabling the blocked path. Do not loosen the Slice 7B synthetic guard. No Business Memory production approval, background scheduling, real checkout/payment or another member's C1/C6/C8 service was implemented.
