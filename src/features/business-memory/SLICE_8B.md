# Slice 8B — local memory transactions and integration

4 November 2026, Asia/Jakarta. The two additive migrations are applied to local Supabase. Five earlier migrations, existing tables/columns/RLS/table grants, text-generation model and synthetic provenance policy are unchanged. No reset, remote mutation, commit, push or deployment.

## 1. Completed versus blocked

Completed: same-signature atomic approval wrapper/transition, business/profile-scoped durable claim, attempt/lease-fenced atomic vector+ack and failure transactions, retry recovery, server/CLI integration, actual job status and explicit worker UI, existing grounded history integration and isolated SQL verification.

The active workflow remains **synthetic draft → owner review/rejection → approval rejected → worker idle → history cold-start**. This is correct eligibility behavior. `evaluationHandoff()` still has `productionEligible=false`; SQL finalization only supports `development_synthetic`. A verified C6/C7 producer and its approved completion contract are not implemented. Positive production-equivalent approval/indexing/retrieval and browser E2E are therefore unverified, not simulated as successes.

## 2. Gap resolution

| Original gap | Implemented change |
| --- | --- |
| Approval only checked final-kind while atomically enqueueing | Existing `approve_campaign_memory` now service-only, checks authenticated owner membership, campaign-context/memory locks, expected content hash, completed/latest reviewed source, persisted source identity/revisions/hash and provenance. Private transition performs approval, audit and unique-key enqueue together. Synthetic rejection precedes transition; purported verified flags cannot bypass the missing real authority. |
| Global queue claim | New `claim_memory_jobs` filters business, `embed_memory`, approved target, compatible model/profile/version and exact durable key; SKIP LOCKED, bounded batch/lease/attempts, expired-lease recovery and scoped exhaustion. It does not claim email/payment jobs. Claim eligibility is queue/target compatibility; source authority is separately checked before provider work and writeback. |
| Independent vector write and job ack | New `complete_memory_index_job` commits vector/ready + succeeded/ack together, or commits failed/retryable/dead together. Expected target/hash/profile/version/attempt and live lease fence writes. Old vector-only RPC loses service EXECUTE; generic `finish_job` rejects memory work. Direct service updates cannot bypass the new transitions. |

Pre-code mapping: [slice-8b-gap-to-fix.md](../../../docs/plans/slice-8b-gap-to-fix.md).

## 3. Migrations

- `20261104093000_memory_approval_and_indexing_transactions.sql`: replacement approval, source/transition helpers, scoped claim, atomic writeback/failure, restricted grants and two memory-only guards.
- `20261104094000_memory_index_recovery.sql`: ready-vector recovery without another embedding; exhausted-job cleanup stays within the requested embedding profile. This is a later migration because the first was already applied; it was not edited afterward.

Both were tested in disposable PostgreSQL before incremental `supabase migration up --local`. No new table, column, index, enum, queue or lifecycle. Existing `domain_events` records approval actor/source/hash/job metadata in the same transaction. Detailed SQL, generated canonical types and schema §28 are the contracts, not a proposed new schema.

## 4. Actual RPC contracts and privileges

```text
approve_campaign_memory(
 p_business_id uuid, p_memory_id uuid, p_content_hash text,
 p_model text, p_profile text, p_actor_user_id uuid) → uuid (job ID)

claim_memory_jobs(
 p_business_id uuid, p_model text, p_profile text, p_embedding_version integer,
 p_limit integer=5, p_lease_seconds integer=60, p_max_attempts integer=5)
 → SETOF job_runs

complete_memory_index_job(
 p_business_id uuid, p_job_id uuid, p_attempt_count integer, p_memory_id uuid,
 p_content_hash text, p_embedding_version integer, p_model text, p_profile text,
 p_embedding vector=NULL, p_error_code text=NULL, p_max_attempts integer=5) → void
```

These public RPCs are SECURITY DEFINER, owner postgres, `search_path=''`, explicit service_role EXECUTE only. PUBLIC/anon/authenticated are denied. The server authenticates GoTrue owner and derives business/actor; worker claims additionally check owner scope before the service call. Private functions have no application-role EXECUTE. Browser inputs cannot choose another business or submit a vector/actor/embedding profile.

`p_error_code=NULL` means success and requires source validation; a safe uppercase error code means an atomic failure result without a vector. Failure may be recorded after source invalidation but still needs the exact job/memory key and live attempt. It never overwrites a ready/stale vector. `match_campaign_memories` remains the existing authenticated, owner-checked SECURITY INVOKER function.

## 5. Concurrency and recovery

Approval/writeback order: existing capacity → preorder → item → product → campaign context, then memory → job. Claims lock only queue rows and inspect compatible memory metadata without a memory row lock. Queue binding is immutable. Provider work is outside SQL.

The existing monotonic attempt counter plus current unexpired `locked_until` is the ownership fence. A reclaimed attempt invalidates a late worker. Retry defaults are five attempts, sixty-second lease, thirty-second failure backoff; batches are explicitly limited to one in the development runner. Exhaustion is durable `dead`, including a crashed last attempt. Existing table stores current job state, not full immutable attempt history.

Approval's durable key is JSON `[memory ID, embedding version, content hash, model, profile]`, protected by the existing unique job key. Exact replay returns the existing job/audit without duplicate effects. Conflicting hashes/profiles reject. Vector-ready recovery acknowledges the same key without another provider call. Identical committed acknowledgement retries are idempotent. An ambiguous HTTP result is read back before a failure is recorded.

The live lease is checked after locks are acquired. Once that transaction holds the job lock, another claimant cannot reclaim it before commit. No process-local timer is the ownership authority. Arbitrary PostgreSQL serialization/deadlock failures remain retryable errors, not success.

## 6. Application workflow

Existing candidate/review code is reused. Eligible explicit approval calls the RPC and then confirms persisted approved state and the returned job. The runner calls scoped claim → runtime-validated job/key/row → source preflight → configured embedding → validated vector → source/lease recheck → atomic SQL result → response.

`node scripts/run-memory-indexing.mjs` is the explicit local owner-A fixture command. It calls the authenticated development API; service credentials stay on the server. There is no background scheduler. Current synthetic data correctly produces `idle`, zero claimed, and no provider request. UI exposes persisted current job/attempt/error and distinguishes an unapproved draft's `embedding_status=queued` from an actually enqueued job.

## 7. Synthetic safety and lower-layer fixtures

The original `reject_synthetic_finalization_memory_approval` trigger remains unchanged. Active JWT/RPC and direct-write tests reject synthetic approval and create no indexing job. New guards also deny independent service vector/ready/job mutations.

Positive transition tests call inaccessible private primitives **only inside the labelled disposable `memory_review` database**, using explicit synthetic/test-only/non-production source JSON. Their public wrappers reject those same records. No approved fixture is copied into the active database, no provenance is relabelled, and no verified order/payment is fabricated.

The original 100 pgTAP assertions and seven legacy memory groups are unchanged and run on their original five-migration contract. Those permissive legacy approval checks are historical compatibility evidence, not current-policy assertions. The complete hardened chain is separately compiled/audited and tested with new rejection, rollback and concurrency cases. Mock tests do not establish SQL atomicity.

## 8. Embedding verification

Intended server model is now explicitly `GEMINI_EMBEDDING_MODEL=gemini-embedding-2`; the Gemini text model and credentials are unchanged. Installed SDK supports `models.embedContent` and `outputDimensionality:768`. Embedding 2 uses task prefixes rather than taskType, consistent with [official Gemini documentation](https://aistudio.google.com/docs/embeddings).

Fake normalized 768-dimensional vectors remain the deterministic test provider, with separate model/profile metadata. They do not prove semantic relevance.

After automatic approval review initially rejected potential cost, the user explicitly authorized **one** real non-sensitive synthetic-text request. That single smoke ran and failed with `EMBEDDING_UNAVAILABLE` after approximately 10.6 seconds. No successful vector or HTTP status was exposed by the normalized adapter; no real vector was stored, and the request was not repeated. Real normalization/pgvector compatibility therefore remains unverified. The smoke script can check temporary rolled-back vector storage after a future successful authorized request; that check did not run this time.

## 9. Retrieval

Existing SQL filters tenant + approved/ready + model/profile/version before similarity ranking/limit. Actual disposable pgvector tests cover bounded matching, incompatible profiles, stale exclusion and foreign-owner denial. Application boundaries validate source references and trusted source freshness before/after matching. Draft/synthetic rows are excluded. A purported verified row without authority gives unavailable, not trusted history. No eligible compatible source gives cold-start; eligible sources with no hits give no-match.

Production-equivalent semantic retrieval remains blocked by source authority and the failed real-provider smoke. No new global document/vector system or alternate matching RPC was added.

## 10. Strategist integration

Existing bounded history contracts, content/source/profile-sensitive context hashes and `memory:<retrieved UUID>` allowlists remain. Typed isolated positive tests prove historical grounding and invented-source rejection while retaining current C2/capacity/financial facts. Active browser tests demonstrate honest cold-start and a subsequent persisted discussion. These are distinct from a successful production-approved memory retrieval.

## 11. Files

| Files | Responsibility |
| --- | --- |
| Two migrations above; `src/lib/supabase/database.types.ts` | Database transitions/guards and regenerated actual RPC types |
| `contracts.ts`, `domain.ts`, `repository.server.ts`, `service.ts`, `index.ts` | Validated worker/job view, durable key checks, approval adapter/readback and current job state |
| `indexing.ts`, `indexing.server.ts`, `api.server.ts` | Atomic worker port, scoped runner, ownership, source/lease checks and safe errors |
| `components/memory-workspace.tsx` | Explicit approval handler, current job status, worker idle/result and linked retrieval results |
| `scripts/run-memory-indexing.mjs` | Repeatable explicit local runner |
| `scripts/test-memory-embedding.mjs`, `tests/provider/memory-embedding.test.ts` | One-request real smoke with strict vector/norm checks and conditional temp SQL compatibility |
| `database/v2.1/tests/memory-transactions.mjs`, `scripts/test-database-v21.mjs` | Isolated atomicity/rollback/race/grant testing; unchanged historical suites staged at their original contract |
| `tests/unit/{business-memory,memory-worker}.test.ts` | Lease/key/failure/reconciliation and scoped runner tests |
| `tests/integration/business-memory.test.ts`, `tests/integration/memory-api.mjs`, `tests/browser/business-memory.mjs` | Real local negative eligibility/security, idle worker and UI regression |
| `tests/browser/campaign-evaluation.mjs` | Wait for the rendered replacement-expense reload before checkbox interaction; all existing assertions retained |
| `.env.example`, ignored `.env.local` | Explicit intended embedding model, no secret/text-model changes |
| Schema §28, QA guide, plan/handoff links | Current versus historical contract/readiness |

## 12. Automated verification

| Actual command/suite | Final result |
| --- | --- |
| `npm.cmd run test:unit` | 432 tests / 18 files passed; existing Slices 1–8 plus worker/key/recovery cases |
| `npx.cmd vitest run tests/integration` | 43 tests / 6 files passed on actual local Supabase, including nine memory cases |
| HTTP discussion / blueprint / execution / evaluation / memory | 4 + 5 + 6 + 7 + 6 = 28 groups passed |
| Chrome simulator / discussion / blueprint / execution / evaluation / memory | 7 + 8 + 8 + 9 + 12 + 10 = 54 groups passed |
| `node scripts/test-database-v21.mjs` | Original 100 pgTAP + three races on original contract; seven legacy memory groups/one race preserved; full hardened chain compiled/audited; ten Slice 8B groups/five observed lock races passed |
| `node tests/integration/evaluation-finalization.mjs` | 14 groups / 12 observed PostgreSQL lock races passed |
| `node scripts/test-supabase-v21.mjs` | 14 groups, final seven-migration catalog 888 MATCH / zero deviations; canonical type compatibility passed |
| `npm.cmd run lint`, `npx.cmd tsc --noEmit --pretty false`, `npm.cmd run build` | Passed |
| `node tests/integration/discussion-production.mjs` | All 15 development page/API checks return 404 in actual production server |
| `node scripts/run-memory-indexing.mjs` | Passed with honest idle / zero claimed; no Gemini call |
| `node scripts/test-memory-embedding.mjs` | One authorized real request **failed**, `EMBEDDING_UNAVAILABLE`; no retry or real-vector storage |

The first browser run exposed a replacement-expense test race: it waited for SQL persistence before the UI finished resetting confirmation. Added a rendered-UI/busy wait without removing an assertion, then all twelve evaluation groups passed. The new worker test likewise now waits for hydrated candidate state before clicking its server-rendered control; all ten memory groups passed. These were synchronization fixes, not weakened expectations or new product behavior.

Worker/candidate screenshots at 1440/390/320 were inspected, overflow assertions passed, and the detector returned `[]`. A separate read-only finish reviewer returned ship for the new UI, with no material fixes. That review did not independently verify transactions or screenshots of legitimately approved/ready/available sources, which do not exist here. The five prior migration hashes remain unchanged. Existing dirty PRD/package/lockfile changes were preserved.

## 13. Security boundaries

Owner/RLS reads, service-only mutations, safe fixed search paths/grants, source/hash/attempt fences, tenant/key/runtime checks and synthetic denial are retained/tested. Memory prose is bounded/untrusted, not SQL or instructions. Existing PII/credential redaction and citation guards remain; they are not a universal natural-language injection detector. Provider secrets/vectors are not printed. Direct privileged table mutation is no longer an alternate indexing path.

## 14. Remaining gates

Verified C6 completeness/revision and approved C7 finalization authority; production C1/C6/C8 producers; real Gemini strategy/evaluation; successful real embedding and semantic retrieval evidence; candidate-text revision/post-completion correction lifecycle; user manual QA. No development approval bypass was added. Such a capability would require separate authorization and explicit provenance isolation.

## 15. Readiness

Slices 1–2 deterministic calculations work locally; 3 uses typed/synthetic producers; 4–7 persist real local SQL with Fake generation/synthetic KPI; 8/8B has real draft/review, hardened transactions and an idle-capable worker, while approved production RAG remains blocked. See the full [readiness matrix](../../../docs/qa/LOCAL_QA_SLICES_1_8.md).

## 16. Manual QA

Use the [complete local QA guide](../../../docs/qa/LOCAL_QA_SLICES_1_8.md). Main routes remain `/dev/discussion`, `/dev/campaign-simulator`, `/dev/campaigns`, `/dev/evaluations`, `/dev/memories` on localhost:3100. Positive isolated lower-layer transaction tests do not turn unavailable manual approval steps into a successful business workflow.
