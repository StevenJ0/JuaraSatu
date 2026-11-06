# Slice 8B gap-to-fix mapping (before implementation)

4 November 2026, Asia/Jakarta. The Slice 8B request explicitly authorizes narrowly scoped additive local RPC/grant/concurrency changes. No table/column, lifecycle, synthetic-provenance policy or remote change is authorized.

| Inspected gap | Smallest fix | Existing functionality retained |
| --- | --- | --- |
| `approve_campaign_memory(uuid,uuid,text,text,text,uuid)` already approves + deduplicates enqueue atomically, but locks only memory and checks final-kind alone | Replace this same signature; service-only owner boundary; campaign-context → memory locks; latest reviewed completed-source/hash/revision checks; preserve synthetic rejection; one approval/enqueue/audit transaction | Existing memory statuses, unique source tuple, unique `(job_type,dedupe_key)` and owner membership |
| `claim_jobs(integer,integer,integer)` claims every tenant/type | Add `claim_memory_jobs` scoped by business, embedding model/profile/version and `embed_memory`; bounded attempts/lease, SKIP LOCKED, expired-lease reclaim and terminal exhaustion | Existing job table/statuses/attempt counter; global claimant unchanged for other modules |
| `complete_memory_indexing` writes a vector independently from `finish_job` | Add one memory-specific success/failure transaction with expected job/attempt/memory/hash/profile/version; lock campaign context → memory → job; valid lease required; exact successful replay; vector + ready + job acknowledgement all commit together | Existing vector(768), queue dedupe identity and attempt counter; Gemini stays outside SQL |

The old vector-only RPC and generic `finish_job` must no longer acknowledge/write memory work independently. Non-memory job completion remains unchanged. Private transition helpers are not callable by service_role, authenticated, anon or PUBLIC; this permits isolated lower-layer testing without exposing a source-validation bypass.

## Source authority remains an independent gate

`evaluationHandoff()` always has `productionEligible=false`, and the only SQL finalization mode is `development_synthetic`. The existing synthetic rejection remains mandatory. Slice 8B does **not** authorize introducing a verified finalization lifecycle or treating JSON flags as proof. Shared source validation will check known persisted identities/revisions and then fail closed with `VERIFIED_C6_UNAVAILABLE` for a purported non-synthetic source until the real C7/C6 authority exists.

Consequently, no legitimate positive production-equivalent approval fixture can be created now. Active Supabase tests cover actual draft/review and negative approval. Positive enqueue/lease/vector transaction tests call inaccessible private transition primitives only inside a labelled disposable database, retaining explicit synthetic/test-only provenance. Public wrappers must reject these fixtures. Positive typed strategist tests remain counterfactual port tests, never approved production data.

## Reach of the change

New timestamped migration; canonical generated types; memory approval/repository/domain contracts; worker port and explicit local runner; retrieval/context attestation wiring where authority exists; current dev UI status/result handling; targeted unit/SQL/HTTP/browser tests; schema addendum and QA/handoff. No dependency, model-text, C1/C6/C8, payment or checkout implementation.

Old pgTAP/legacy memory assertions are preserved verbatim and exercised on their original five-migration contract. The complete new chain and new source/lease/atomicity assertions are verified separately; obsolete permissive approval is not represented as an invariant of the hardened contract.

## Implemented result

The two new additive migrations are locally applied and their actual signatures/grants, source gate, private primitives and test boundaries are documented in [SLICE_8B.md](../../src/features/business-memory/SLICE_8B.md). No source-authority or development-approval bypass was introduced. The current public synthetic workflow deliberately rejects approval and reports worker idle.
