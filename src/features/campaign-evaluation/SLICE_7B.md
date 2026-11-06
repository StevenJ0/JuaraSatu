# Slice 7B — Evaluation CAS & atomic campaign finalization

Verified locally on 4 November 2026. Evaluation generation/review now use PostgreSQL source/latest-evaluation CAS. Explicit development completion atomically appends an audited final evaluation and transitions `closed → completed`. **Verified production completion remains unavailable until an authoritative, transactionally coordinated C6 revision contract exists.** No remote operation, reset, commit, push, deployment, dependency or Gemini change was made.

## 1. Result and root cause

Slice 7 preflight checked a context hash before calling `record_campaign_evaluation`. That RPC had no expected latest evaluation/source condition, only an idempotent append. Costs used service-role INSERT/UPDATE plus an invalidating campaign trigger; tasks used independent row-version PATCH. Neither task nor cost writers froze completed campaigns. The old operation could not atomically complete the lifecycle.

The new operations retain append-only history and existing campaign/source versions. The latest evaluation **UUID** is the CAS token, with `null` meaning no previous evaluation. There is no new application revision counter, table, column, enum or index. PostgreSQL assigns evaluation creation order under the campaign lock, including legacy insert writers.

## 2. Changed files

| Files | Purpose |
| --- | --- |
| `supabase/migrations/20261104090000_evaluation_cas_and_finalization.sql` | Two privileged RPCs, source/latest CAS, source-writer coordination, completion seal |
| `supabase/migrations/20261104091000_seal_completed_campaign_updates.sql` | Reject even no-op completed-campaign UPDATE before `touch_row` can increment its version |
| `supabase/migrations/20261104092000_reject_synthetic_finalization_memory_approval.sql` | Reject approved memory sourced from the new simulated completions; no memory is created |
| `src/lib/supabase/database.types.ts` | Regenerated from actual local Supabase; compatibility export remains unchanged |
| `src/lib/supabase/transport.server.ts` | Narrow nullable UUID-argument correction for the initial CAS token; generated RPC args omit SQL nullability |
| `contracts.ts` | Expected latest token, validated completion audit/final rows, live eligibility DTO |
| `repository.server.ts` | Actual latest-ID read, typed CAS/finalize adapters, named SQL conflict/error mapping |
| `service.ts` | Latest/source preflight, database CAS persistence, explicit finalize/reconciliation, sealed-source handoff |
| `context.ts`, `calculate.ts` | Replace obsolete missing-RPC wording; preserve financial formulas and production fail-closed eligibility |
| `components/evaluation-workspace.tsx` | Current evaluation prerequisites, explicit simulated finalization confirmation, completed readback, recovery messages |
| `../campaign-execution/components/execution-workspace.tsx` | Keep the evaluation link visible for completed campaigns and explain frozen checklist state |
| `index.ts` | Public audit/finalization schemas and handoff helpers |
| `tests/fixtures/local-evaluation.mjs` | Include actual expected latest evaluation ID |
| `tests/unit/evaluation-finalization.test.ts` | Ten prerequisite, provenance, audit, legacy-summary, completion-source and error-classification tests |
| `tests/integration/campaign-evaluation.test.ts` | Preserve eight scenarios; strengthen old post-preflight race expectation to database rejection/no stale row |
| `tests/integration/evaluation-finalization.mjs` | Fourteen real PostgreSQL/HTTP groups and twelve observed lock races, including legacy writers/provenance/grants/rollback |
| `tests/integration/evaluation-api.mjs` | Preserve six scenarios and add actual completed transition/replay/conflict/readback |
| `tests/browser/campaign-evaluation.mjs` | Preserve existing interactions, replace obsolete blocked-completion assertion, add visible stale-finalization recovery |
| `docs/schema.md` §27, `docs/plans/slice-7-database-gaps.md`, this handoff, `docs/examples/slice-7b-finalized-evaluation.json` | Additive contract notes, resolved/remaining boundaries and actual persisted example |

The two previously applied migrations are unchanged. The three new files were applied incrementally; later discoveries were corrections in further migrations, never edits of an already applied file. Existing dirty PRD/package/lockfile changes were preserved.

## 3. Actual database operations

`record_campaign_evaluation_cas(p_business_id uuid, p_campaign_id uuid, p_blueprint_id uuid, p_evaluation_id uuid, p_expected_evaluation_id uuid, p_metrics jsonb, p_analysis jsonb, p_limitations jsonb, p_calculated_at timestamptz, p_actor_user_id uuid) → uuid`

- Requires `auth.role() = service_role` and the established `private.require_owner` check with the server-authenticated owner UUID.
- Locks the existing campaign context, checks actual business/campaign scope, requires `closed`, checks latest persisted evaluation ID and current source revisions.
- Validates published approved blueprint, preorder/item/campaign identity and versions, spending review state and the **entire** task/content/cost `(id,version)` sets. Phantom entries therefore conflict too.
- Review must reference the current latest unreviewed parent, retain its context, deterministic summary and narrative/provider metadata, and record the actual owner/review time. It inserts a new immutable row.
- Adds `metrics_json.cas.expectedEvaluationId`. Stable request UUID + server-generated command hash + expected latest + scope identifies an identical command. Concurrent provider invocations may still occur; only the first persisted result is reused. This is not a claim of exactly-once provider execution.

`finalize_campaign_evaluation(p_business_id uuid, p_campaign_id uuid, p_preorder_id uuid, p_evaluation_id uuid, p_request_id uuid, p_expected_campaign_version integer, p_expected_context_hash text, p_mode text, p_actor_user_id uuid) → uuid`

- Uses the same trusted owner boundary and lock order. Requires expected preorder/campaign scope, closed state/version, published approved historical blueprint/baseline and the exact latest reviewed CAS evaluation.
- Rechecks all persisted source revisions and the stored context hash in the transaction. Requires confirmed promotion costs and known KPI/production-cost fields plus operational completeness.
- The supported mode is **`development_synthetic` only**. It requires persisted development-fixture KPI provenance, provisional flags, no invented financial-scope order IDs and synthetic analysis. Actual preorder orders/reservations must be absent. `verified` or other modes fail `VERIFIED_C6_UNAVAILABLE`; unknown costs/KPI fail independently.
- Atomically appends a `final` evaluation at `p_request_id`, retaining its closed source context, reviewed parent, provider findings and synthetic/provisional observations. `metrics_json.finalization` records mode, request ID, reviewed evaluation ID, expected/completed campaign versions, timestamp, authenticated actor and source hash. It then writes `status=completed` and the same completion timestamp.
- The campaign version advances once. The final row is the durable source reference; no nonexistent campaign evaluation-pointer column is invented.
- Identical durable requests replay the same final UUID/timestamp without another lifecycle effect. Reusing an ID with different arguments conflicts. A different request after completion fails the lifecycle check. There is no independent client success before persisted readback.

Both RPCs are `SECURITY DEFINER`, owned by the existing migration owner `postgres`, with empty `search_path`. EXECUTE is revoked from PUBLIC/anon/authenticated and granted only to service_role. All new private helpers have explicit EXECUTE revocations. Existing RLS, table grants and legacy RPC signatures remain unchanged.

## 4. Writers, locking and freshness

| Source/writer | Coordination and limitation |
| --- | --- |
| Cost INSERT, amount/correction UPDATE, void PATCH | New BEFORE trigger locks its campaign; existing AFTER trigger invalidates spending review and advances campaign version. Binding cannot move across business/campaign. |
| Task completion/reopen PATCH | Existing task-row version CAS retained; BEFORE trigger locks campaign. Full task revision set is checked by evaluation/finalization. |
| Content/blueprint INSERT/UPDATE | Same campaign lock and completed-state rejection; existing immutable-approved-blueprint guard retained. |
| Spending completeness PATCH | Updates the campaign row itself with expected version and closed status. |
| Evaluation INSERT, including legacy RPC/direct service writer | BEFORE trigger locks campaign, rejects completed inserts, assigns strictly later creation time. New CAS envelopes additionally enforce latest/source checks. Legacy envelopes remain historical snapshots, not reviewed finalization candidates. A concurrent legacy append changes the latest token and invalidates finalization. |
| Campaign lifecycle | Existing context locks; new guard requires an audited final row for completion through the trusted definer transaction. Direct service-role completion PATCH fails. |
| Preorder/item versions | Existing context locks stabilize these rows and their revisions. Historical catalog pricing is not substituted. |
| Development C6 | Synthetic source is calculated from frozen data/scenario, with provenance persisted. No production KPI revision authority exists; verified completion is therefore rejected. |

Lock order for RPCs remains capacity → preorder → item → product → campaign. Child writers lock their changed row (UPDATE) then campaign in their BEFORE trigger. Evaluation/finalization **never lock child source rows**: after acquiring campaign they read committed source revisions, so they do not form a campaign→child-row lock cycle against those direct writers. A completed source cannot be changed after waiting for finalization. A source writer that commits first makes the evaluation/finalization source check fail. No global lock is added.

The application hash is a content/provenance identity and useful preflight. The database freshness guarantee comes from locked persisted revisions, exact set membership and latest-ID checks, not from recomputing an application hash in SQL. The guarantee is the transaction's serialization point; a later authorized source change can make an ordinary reviewed **closed** snapshot stale. Finalization seals its relevant campaign data.

Other workflows can still produce a confirmed PostgreSQL serialization/deadlock abort. Named `STALE_SOURCE_STATE`/`STALE_EVALUATION_VERSION` map to 409; arbitrary `40001` and `40P01` map to retryable 503. The shared transport retries only a confirmed PostgreSQL serialization abort once; it never blindly retries an ambiguous network outcome.

## 5. Post-completion policy

All campaign UPDATEs, including no-op updates, are rejected. Cost/task/content/blueprint INSERT/UPDATE and further evaluation INSERT are rejected for that completed campaign. Existing append-only evaluations cannot be edited/deleted; existing service-role grants do not permit DELETE. Historical rows remain readable.

The PRD does not define ordinary corrections after completed campaign finalization. This slice provides no reopen, financial correction or re-finalization lifecycle. A separate approved design is needed for that. Preorder/order lifecycle is not reimplemented or globally frozen; verified production finalization remains blocked.

## 6. Request flow and failed paths

`Development UI explicit confirmation → existing /api/dev/evaluations action=finalize → development/environment guard + real GoTrue owner + Origin/body/Zod validation → JWT-scoped campaign/evaluation reads → preflight/latest/hash checks → service-only atomic RPC → fresh persisted campaign/history readback → completed response`.

Review/generation use the same boundary and the new CAS RPC. No client-provided business/actor/KPI payload is accepted. Failures preserve closed state and immutable history: missing review/evaluation, stale source/latest token, invalid lifecycle, unresolved spending, incomplete KPI, foreign tenant, unsupported production provenance and transport/database failures have distinct safe outcomes. Uncertain finalization responses are reconciled using its persisted request UUID/audit; same payload can be retried.

## 7. Synthetic safety and Slice 8 contract

Completion here means **a sealed local simulation**, not verified financial performance. `evaluation_kind=final` describes the final simulation snapshot; KPI `isProvisional=true`, development provenance, Fake provider metadata and finalization mode remain explicit. Production routes return 404 and the server additionally requires development/test plus the existing synthetic environment opt-in. Database grants do not expose a browser bypass.

The existing memory approval RPC previously accepted any final-kind evaluation. A narrowly scoped BEFORE guard now rejects `review_status=approved` for memory sourced from these new `development_synthetic` completions, including direct service-role writes. The negative SQL test aborts before inserting a row or queueing a job. No memory generation, approval, indexing or retrieval is implemented here.

`evaluationHandoff()` validates the sealed source, recalculates its deterministic summary, validates narrative/source bindings and completion audit, and exposes business/preorder/campaign/blueprint/evaluation identities, reviewed strategy/findings, current source versions, provenance, completeness and completion metadata. `evaluationCurrentHash()` normalizes **only the witnessed completion transition** (version +1/status/completed_at and corresponding C6 campaign revision) when comparing final source facts. Unrelated source or scenario changes remain stale.

Current completed synthetic sources can be `developmentEligible=true` for a future explicitly isolated development test. They always have `productionEligible=false` and `SYNTHETIC_EVALUATION` exclusion. Ordinary provisional/closed or stale snapshots have further exclusions. Slice 8 has not started.

## 8. Verification

| Check actually executed | Result |
| --- | --- |
| `npm.cmd run test:unit` | 369 passed across 13 files (359 existing + 10 new) |
| `npx.cmd vitest run tests/integration` | 34 passed across 5 files; real local Supabase JWT/RLS/repository operations |
| `node tests/integration/evaluation-finalization.mjs` | 14 groups; 12 actual two-connection PostgreSQL lock races observed through `pg_stat_activity` |
| HTTP scripts `discussion-api`, `blueprint-api`, `execution-api`, `evaluation-api` | 4 + 5 + 6 + 7 = 22 groups passed |
| Chrome browser scripts simulator, persistent discussion, blueprint, execution, evaluation | 7 + 8 + 8 + 9 + 12 = 44 groups passed |
| `node scripts/test-database-v21.mjs` | Full five-migration clean application on disposable PostgreSQL; 100 pgTAP assertions + 3 existing races passed |
| `node scripts/test-supabase-v21.mjs` | 14 local groups; 879 catalog MATCH, zero deviations; generated types agree |
| `node tests/integration/discussion-production.mjs` | 12 development GET/POST routes return 404 in an actual local production server |
| `npm.cmd run lint`; `npx.cmd tsc --noEmit --pretty false`; `npm.cmd run build` | Passed |
| Impeccable detector and visual check | Detector `[]`; actual 1440/390/320 browser screenshots inspected, no page overflow |

Race cases cover phantom cost insertion, cost void/correction, task changes vs finalization/review, concurrent reviews, a newer review vs finalization, cost/task writes after finalization wins, competing finalizations and identical concurrent retries. Further SQL/HTTP checks cover missing/unreviewed evaluation, draft/published lifecycle, wrong revisions/owner, unknown costs/KPI, unsupported production mode, actual RPC-denied owner/anonymous JWTs, outer transaction rollback, append-only parents, post-completion writes (including no-op UPDATE), synthetic approval exclusion and zero memory rows. Earlier obsolete blocked-finalization expectations were replaced with stronger rejection/success/persistence assertions; tests were not disabled.

## 9. Migration and contract status

All three Slice 7B migrations are locally applied. Both preceding migration SHA256 values remain:

- `20261103000000_initial_v21.sql`: `1B3612E0DA1FB181C9ABBDD70D13B7A6BB35C4A21D93195F479E86E1B1C8617A`.
- `20261103090000_atomic_campaign_blueprint_creation.sql`: `89935A0868F89407795BF00041EC7E315ED38B6269281C6F1A95344360858580`.

The full chain retains 26 tables, 351 columns, existing constraints/indexes/RLS/table permissions; additions are RPCs/helpers/triggers only. Local database contents were preserved. The old planning document/database-rules baseline description still refers to the superseded 17/19-table design; current migrations and this verified contract are authoritative. No old baseline, PRD or unrelated configuration was rewritten.

## 10. Local reproduction

Use the already-running local Supabase and `npm.cmd run dev -- --port 3100`. Keep the existing server-only synthetic flags; no Gemini key/model change is needed. If migrations have not been applied in another local checkout, review the SQL then `npx.cmd supabase migration up --local` (requires the repository's explicit schema authorization; never reset/linked/push).

```powershell
node scripts/prepare-campaign-execution.mjs --evaluation
node scripts/prepare-campaign-evaluation.mjs
```

These commands append/reuse explicitly isolated synthetic fixtures without rewriting historical dates or deleting data. Read the resulting campaign ID from ignored `node_modules/.cache/campaign-evaluation/scenario.json`.

1. Login at `http://localhost:3100/dev/discussion` using the existing synthetic local owner.
2. Open `http://localhost:3100/dev/evaluations?campaignId=<prepared campaign ID>`.
3. Inspect costs/checklist and the synthetic KPI label. Explicitly confirm spending completeness if needed.
4. Generate and save an evaluation, then check the owner-review confirmation and save the review.
5. Check the **separate** simulated-finalization confirmation and select **Finalisasi simulasi lokal**.
6. Refresh: `completed`, its timestamp and final audited evaluation persist; cost/task changes are blocked. No memory is created.

Prepared closed campaign for a fresh manual run: `http://localhost:3100/dev/evaluations?campaignId=1100fc10-d09a-4014-9986-02ef376e68b7`. Persisted completed browser example: `http://localhost:3100/dev/evaluations?campaignId=c62fb068-e8d8-4223-87dd-188e9d2bebea`. Both belong to the synthetic owner A; read the current fixture manifest if its preparation is renewed.

For automated reproduction run the scripts listed in §8. Browser results and actual persisted examples are in ignored `node_modules/.cache/campaign-evaluation/`; a safe synthetic final row is copied to the documented example.

## 11. Remaining limitations

Production C1/C6/C8 integration, verified KPI revision/operational coordination, real Gemini evaluation and audited post-completion corrections are not supplied by this task. A checked synthetic cohort is deliberately narrower than future production completion. Current dev evaluation routes are not production endpoints. No claims are made about real sales, cash settlement, causal uplift or a production finalization path.

## 12. Review points

Review the SQL writer protocol, the three additive migration files, completion audit JSON and memory-approval exclusion before sharing migrations with teammates. There is no database rollback/reset script; migrations are additive and preserve data. Applying them remotely remains a separate team-reviewed operation.

## 13. Slice 8 readiness

The sealed, reviewed, versioned C7 handoff is ready for review and isolated development consumption. It is not a production memory source. Any future development memory tests must keep synthetic provenance and isolation; approval of these sources is currently forbidden by SQL. No Slice 8 implementation was begun.
