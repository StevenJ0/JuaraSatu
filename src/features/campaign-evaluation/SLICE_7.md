# Slice 7 — AI Campaign Evaluation & Finalization

**Follow-up:** [Slice 7B](SLICE_7B.md) resolves the source/latest CAS and atomic development-synthetic finalization gaps through a separately authorized additive migration chain. This document preserves the original Slice 7 delivery state; verified production finalization remains unavailable.

Verified locally on 4 November 2026 (Asia/Jakarta). The provisional evaluation/cost/review workflow works end-to-end with real Supabase Auth and persistence. **Closed→completed finalization and database-enforced evaluation revision/source CAS remain blocked by verified SQL capability gaps.** No schema, migration, RPC, grant, model or remote environment was changed.

## 1. Delivered scope and explicit boundary

An owner can open a closed campaign, inspect its persisted approved strategy/tasks, compare planning assumptions with explicitly synthetic or unavailable C6 observations, record/void promotion costs, confirm spending completeness, generate/save Fake AI interpretation, append an explicit owner-reviewed snapshot and reload history. Provider failure and invalid output preserve deterministic facts with explicit failure metadata.

All new evaluation rows use `evaluation_kind=provisional`. An owner-reviewed snapshot is still provisional. No campaign is marked completed and no Business Memory, embedding or retrieval operation is added.

[Verified database gaps](../../../docs/plans/slice-7-database-gaps.md) explain the exact missing capabilities. AGENTS.md §4 and Task 7.8 require a separately authorized database task rather than independent evaluation insert + campaign status PATCH. The previous Slice 5 authorization covered only its one additional creation RPC and does not authorize new Slice 7 database objects.

## 2. File inventory

| File | Responsibility |
| --- | --- |
| `src/features/campaign-evaluation/contracts.ts` | Zod cost, campaign C6 consumer, context, deterministic summary, narrative, persisted envelope, owner review, actions and view contracts |
| `src/features/campaign-evaluation/context.ts` | Published/closed measurement window, ownership/source bindings, freshness, provenance, stable context hash and limitations |
| `src/features/campaign-evaluation/calculate.ts` | Safe deterministic KPI/budget/contribution/checklist calculations and structured assessments |
| `src/features/campaign-evaluation/development-provider.ts` | Explicitly development/test-only synthetic C6 adapter and context-sensitive Fake Evaluation Provider |
| `src/features/campaign-evaluation/engine.ts` | Provider failure handling; structured interpretation, reference, numeric-prose and contradiction checks |
| `src/features/campaign-evaluation/repository.server.ts` | JWT reads, actual cost append/void/review writers, append-only evaluation RPC and SQL error mapping |
| `src/features/campaign-evaluation/service.ts` | Context/generation/review/cost orchestration, replay reconciliation, source revalidation, Slice 8 handoff and fail-closed finalization |
| `src/features/campaign-evaluation/api.server.ts` | Reused owner auth, development/origin/body/input boundaries and minimum GET/POST actions |
| `src/features/campaign-evaluation/index.ts` | Public domain schemas, types and functions |
| `src/features/campaign-evaluation/components/evaluation-workspace.tsx` | Strategy/task review, current-vs-stored metrics, costs, scenarios, narrative/history/review, stale/error states and visible finalization blocker |
| `src/features/campaign-evaluation/components/evaluation.css` | Existing UI conventions and responsive report/ledger/history layout |
| `src/app/dev/evaluations/page.tsx`, `src/app/api/dev/evaluations/route.ts` | Development-only page and thin API route |
| `src/lib/supabase/transport.server.ts` | Generated-type-constrained INSERT + representation readback; RPC/auth POST behavior preserved |
| `src/features/campaign-blueprint/index.ts` | Expose the existing stable JSON `fingerprint` through the feature's public contract; implementation unchanged |
| `src/features/campaign-execution/components/execution-workspace.tsx` | Link closed campaigns to evaluation |
| `scripts/prepare-campaign-execution.mjs` | Reuse existing fixture tooling with an explicit `--evaluation` namespace; independent preorders prevent Slice 6/7 test contention |
| `scripts/prepare-campaign-evaluation.mjs` | Reproducible dedicated closed campaign, partial checklist and owner-reported synthetic expense |
| `tests/fixtures/local-campaign.mjs` | Optional same-owner scope override for isolated fixture scenarios; default Slice 6 behavior preserved |
| `tests/fixtures/local-evaluation.mjs`, `tests/fixtures/evaluation.ts` | Real-HTTP local setup and typed pure evaluation fixture |
| `tests/unit/campaign-evaluation.test.ts` | 33 new calculation/provenance/guard/provider cases |
| `tests/integration/campaign-evaluation.test.ts` | Eight actual Supabase RLS/transaction/cost/replay/staleness cases |
| `tests/integration/evaluation-api.mjs` | Six real HTTP groups |
| `tests/browser/campaign-evaluation.mjs` | Eleven Chrome E2E groups, refresh, review, corrections, failures, mobile and blocked finalization |
| `tests/integration/discussion-production.mjs` | Also verify evaluation page/API GET/POST return 404 in production |
| `.env.example`, ignored `.env.local` | Explicit evaluation synthetic opt-in; template has no credentials |
| `docs/plans/slice-7-database-gaps.md`, this document, `docs/examples/slice-7-evaluation.json` | Database boundary, handoff and complete persisted synthetic example |

No dependencies were added. Existing PRD/schema/package/lockfile working-tree changes predate this slice and were preserved. Generated types and both active migrations remain unchanged.

## 3. Architecture and source classification

`Closed persisted campaign → owner JWT/RLS → published approved blueprint + task/content snapshot + recorded cost ledger → validated C6 consumer snapshot/unavailable source → context/hash → deterministic calculation → Fake Provider → narrative validation → record_campaign_evaluation → JWT readback/history → explicit owner review as a new snapshot`.

The API accepts identifiers, expected source version/hash and bounded scenario selections. It never accepts authoritative KPI/revenue objects or owner/business IDs from the browser. User descriptions/captions are untrusted data. The provider receives only calculated summary facts and an allowlist of references, not raw orders, customer data or free business instructions.

| Class | Source / treatment |
| --- | --- |
| Planned KPI / hypothetical sales | Persisted approved blueprint; shown separately, never reused as observed results |
| Publication baseline | Actual SQL `baseline_json`; zero for the isolated empty database fixtures |
| Recorded promotion expense | Actual `campaign_costs` rows reported by the authenticated synthetic owner; reported spending is not verified cash |
| Synthetic KPI | Explicit `development_fixture` C6 projection, provisional, no order IDs/payments fabricated |
| Sandbox KPI | Separate C6 provenance with a warning that Sandbox is not real cash; not the active development producer |
| Authoritative KPI | Supported by the consumer DTO/DI boundary; production producer not installed |
| Unavailable/unknown KPI | Explicit unavailable/null; never inferred from publication, checklist completion or planned revenue |

The existing `C6ContextSnapshotSchema` is a preorder-level planning projection. It does not contain the campaign-window/attribution/financial-union fields required by PRD §16.3. This slice defines a bounded **consumer contract**, `CampaignAnalyticsSnapshotSchema`, and a development producer for that contract. It does not implement Indro's production aggregation or reconstruct metrics from raw orders/payments.

## 4. Public KPI and financial contracts

`index.ts` exports schemas `CampaignAnalyticsSnapshotSchema`, `EvaluationContextSchema`, `EvaluationSummarySchema`, `EvaluationNarrativeSchema`, `EvaluationRowSchema`, `EvaluationViewSchema`, generation/review/cost command schemas and `EvaluationError`; types `EvaluationContext`, `EvaluationSummary`, `EvaluationNarrative`, `EvaluationProvider`, `EvaluationRow`, `EvaluationView`, `AnalyticsRead`; functions `buildEvaluationContext`, `evaluationWindow`, `calculateEvaluation`, `interpretEvaluation`, `validateEvaluationNarrative`, `evaluationService`, `evaluationHandoff`.

Server entry points are `evaluationRepository`, `evaluationDatabaseError`, `evaluationGet` and `evaluationPost` in their named `.server.ts` files.

C6 fields include scope IDs, source ID/version, current campaign version, calculated timestamp, provenance, provisional/cost/operational completeness, exact measurement window and distinct-union financial scope. Metrics are nullable current preorder paid units, paid units in window, attributed window/lifetime units, pricing-campaign units, scoped fulfilled sales, scoped incurred production cost and applied discount value. Synthetic snapshots have no invented financial-scope order IDs. Provided real scope ID arrays must be distinct.

The measurement window is `[max(starts_at,published_at), min(ends_at,closed_at,calculated_at))`. Context checks actual campaign/preorder/blueprint ownership, approved materializations, cost ownership, C6 scope/current campaign version/window and a maximum sixty-second C6 source age. Original approved source versions, current preorder/item/campaign versions and task/cost versions remain in the snapshot. Current catalog prices are not used to reprice historical results.

Calculations:

- `actualPromotionSpendIdr = sum(nonvoid campaign_costs)` only after explicit completeness review; before review it is null while known recorded subtotal is displayed separately.
- `budgetVarianceIdr = reviewed spending − planned budget`; positive means overspend.
- `contributionIdr = C6 scoped fulfilled sales − C6 scoped incurred production cost − reviewed promotion spending`; null unless every required cost/revenue source is known/complete.
- C6 revenue is already net of applied discounts. Applied discount value is not subtracted again. Actual contribution is not rebuilt from catalog cost or hypothetical blueprint contribution.
- Target achievement uses floor basis points; it may exceed full target. Checklist completion is a separate deterministic ratio and is not proof of a post or a sale.
- Monetary totals use the existing integer IDR bounds, with BigInt intermediate arithmetic. Overflow is rejected. Confirmed zero, negative contribution and unknown/null remain distinct.

No CAC/CTR/ROAS or causal uplift is invented. `finalizationEligible` remains false with explicit blockers.

## 5. Provider and guardrails

`EvaluationProvider.generate({ summary, references }): Promise<unknown>` is the small provider boundary. The Fake Provider reads the supplied assessments/financial/execution facts and produces corresponding findings, shortfalls, warnings and recommendations. It is not an unrelated fixed report.

Scenarios: exceeds target, below target, spending impact, incomplete manual checklist, missing production ledger, provisional operations and unavailable C6. Execution status always comes from stored task rows; selecting a scenario does not complete tasks, create expenses or invent orders. The separate provider scenarios are valid, failure and invalid output.

The same engine validates structured assessments against deterministic outcomes, financial sign/availability and execution completion. Prose cannot carry free numeric/currency/percentage values; the UI renders authoritative numbers separately. Foreign references, additional metric fields, obvious unsupported causal/guarantee language and supported contradiction patterns are rejected. This is a bounded application guard, not a claim of universal semantic detection for an arbitrary future LLM.

Provider throws/timeouts become `analysis_json.status=failed`; invalid structures/claims become `invalid`. Narrative is null in both cases, and facts/limitations can still be saved. Available status requires a validated narrative. Owner review audit requires the server-verified owner UUID and timestamp.

Real Gemini can later supply an adapter returning the same structured narrative through these checks, with its own bounded transport/cancellation. No SDK inference, configured Gemini model change or verified real-Gemini claim was made here.

## 6. Persistence, costs and concurrency

Reads reuse campaign/preorder/item/blueprint/task/content data plus `campaign_costs` and `campaign_evaluations`. Business reads use real owner JWTs and tenant filters. Privileged writes happen only after scoped owner reads.

| Operation | Actual storage / integrity |
| --- | --- |
| Append expense | Existing service-role INSERT grant; stable request UUID is row UUID; same fields replay, conflicting reuse rejects |
| Void expense | Existing version-filtered UPDATE; amount/category/original description are retained; reason/time are recorded; no delete or silent replacement |
| Confirm expense completeness | Existing campaign UPDATE with exact campaign version and closed state; zero spending requires explicit confirmation |
| Invalidate cost review | Existing `cost_changed` trigger atomically marks campaign unreviewed and advances campaign version on cost append/change |
| Save evaluation | Existing service-only `record_campaign_evaluation`; one complete JSON snapshot insert, owner and FK checks, immutable history, UUID + exact-payload idempotency |
| Owner review | A new immutable provisional evaluation referencing its parent in the validated JSON envelope; actor/time in analysis review metadata |
| Finalize | No write; authorized local attempt returns `FINALIZATION_DATABASE_CAPABILITY_MISSING`/409 |

The persistence envelope stores the context, calculated summary, stable command hash, parent evaluation UUID and original source-facts timestamp in `metrics_json`. `analysis_json` stores Fake Provider status/narrative and application-owned review audit. No new column or fake evaluation status is invented: database kind remains provisional. `source_ai_generation_id` is null because the current evaluation RPC has no parameter to atomically link a separate generation; provider provenance remains explicit in the validated analysis JSON.

Generation refreshes context before and after provider output. Same UUID/command retries return persisted state without another provider call; concurrent identical UUID attempts reconcile one durable record. Database FK failure leaves no partial evaluation. Cost duplicate/CAS/review/void behavior is tested against real PostgreSQL.

**Source checks are preflight, not database source/revision CAS.** Existing evaluation RPC does not accept expected source versions or a parent/latest-evaluation condition. A source change after preflight can leave a valid dated historical provisional snapshot; current readback marks it stale, and review/finalization/memory eligibility do not treat it as current. An integration test intentionally commits a cost in that interval and verifies this limitation. No linear revision order or atomic latest-evaluation guarantee is claimed.

This model does not replace the missing finalization transaction. A separate authorized database task must coordinate finalization with task/cost writers before those mutable sources can be frozen safely.

## 7. Persisted synthetic example

[Complete example JSON](../../../docs/examples/slice-7-evaluation.json) contains an actual local persisted, owner-reviewed provisional row, its source context, cost/void history, narrative, audit and memory exclusions. UUIDs/timestamps are example references, not portable seed/API payloads.

| Item | Example |
| --- | --- |
| Campaign / approved blueprint | Discount campaign, published and explicitly closed using existing RPCs |
| Frozen / campaign unit price | Rp120,000 → Rp108,000 at ten percent, computed once through C2 |
| Planned additional units / revenue / contribution | Six / Rp648,000 / Rp173,000, all hypothetical |
| Actual SQL baseline in empty fixture | Zero paid units at publication |
| Synthetic observed window units | Eight; total synthetic preorder units eight |
| Synthetic attributed / pricing units | Five / eight; distinct from each other |
| Synthetic scoped fulfilled sales / incurred production cost | Rp864,000 / Rp600,000 |
| Planned budget / reviewed recorded spending | Rp25,000 / Rp50,000 |
| Budget variance | Rp25,000 overspend |
| Synthetic contribution | Rp214,000, not real revenue/profit/cash |
| Target achievement / manual checklist | 133.33 percent / one of two tasks |
| Evaluation | Owner-reviewed new snapshot; still provisional and synthetic |
| Campaign / memory | Remains closed; production memory eligibility false |

The fixture publishes and closes using actual timestamps without rewriting history. Its short elapsed measurement window does not provide evidence of transactions; the eight-unit observations are explicitly simulated and no paid order rows are created. Recommendations review spend and unfinished checklist and require an authoritative producer for operational evaluation; they make no causal claim.

## 8. Local UI and reproducible setup

Required existing local flags plus:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<local-public-key>
SUPABASE_SERVICE_ROLE_KEY=<server-only-local-key>
CAMPAIGN_DISCUSSION_PROVIDER=fake
CAMPAIGN_DISCUSSION_CONTEXT=seeded
CAMPAIGN_BLUEPRINT_PROVIDER=fake
CAMPAIGN_BLUEPRINT_APPROVAL=synthetic
CAMPAIGN_EXECUTION_MODE=synthetic
CAMPAIGN_EVALUATION_MODE=synthetic
```

Never print or commit actual keys/passwords. Existing private synthetic credentials remain in `node_modules/.cache/database-v21-cutover/fixture-credentials.json`.

Setup with the local Supabase stack and Next development server running:

```powershell
npm.cmd run dev -- --port 3100
# In another terminal:
node scripts/prepare-campaign-execution.mjs --evaluation
node scripts/prepare-campaign-evaluation.mjs
```

The first command reuses the existing fixture tool to create/reuse separate future-valid Slice 7 preorders on free fulfillment dates, preserving all old records. The second uses real discussion/blueprint/approval/publish/task/close APIs and records/reviews a synthetic expense. No date/capacity guard is weakened, no active database is reset and no fake verified payment is inserted. Still-valid manifests are reused. Private manifests are under `node_modules/.cache/campaign-evaluation/`; the prior manifest is retained when moving from the initial shared setup to the isolated namespace.

- Login: **http://localhost:3100/dev/discussion**.
- Owner dashboard: **http://localhost:3100/dev/evaluations**.
- A closed campaign's execution page links through **Tinjau KPI, biaya & evaluasi**.
- The prepared campaign UUID is in `scenario.json`; the reviewed browser example UUID is in the complete example JSON above. Open `/dev/evaluations?campaignId=<uuid>` after login.
- Verified reviewed example: **http://localhost:3100/dev/evaluations?campaignId=02c82007-0481-43b0-a44e-346cf4854169**.

Manual flow: choose closed campaign → inspect approved strategy/tasks and the visible synthetic label → record expense → explicitly confirm completeness, including zero → choose KPI/provider scenario → generate/save provisional snapshot → review facts/limitations → explicitly save owner review → refresh. A correction uses void with a reason, followed by an independently recorded replacement; it invalidates spending review and prior source freshness. Current metrics and numbers stored in a selected historical snapshot are displayed separately.

The finalization button is visibly disabled with its database blocker. The backend independently rejects a forged/direct finalize attempt. Existing historical campaign state is never changed to make the demo appear complete.

API `/api/dev/evaluations`: GET owned closed/completed campaign list; GET `?campaignId=<uuid>&scenario=<allowed-value>` returns context, measurement window, calculated summary and history; POST actions `generate`, `review`, `create_cost`, `void_cost`, `review_costs`, `finalize` use strict DTOs. All responses are no-store; cookie writes require matching Origin; action body limit is the established 16 KiB. Fake mode and all routes fail closed in production.

## 9. Automated verification

| Check | Result |
| --- | --- |
| `npm.cmd run test:unit` | **359 passed**: previous 326 plus 33 evaluation cases |
| `npx.cmd vitest run tests/integration` | **34 passed**, including eight actual Supabase evaluation/cost/source-race cases |
| `node tests/integration/discussion-api.mjs` | Four prior groups passed |
| `node tests/integration/blueprint-api.mjs` | Five prior groups passed |
| `node tests/integration/execution-api.mjs` | Six prior groups passed |
| `node tests/integration/evaluation-api.mjs` | Six evaluation groups passed; **21 total HTTP groups** |
| `node tests/browser/persistent-discussion.mjs` | Eight prior groups passed |
| `node tests/browser/campaign-blueprint.mjs` | Eight prior groups passed |
| `node tests/browser/campaign-execution.mjs` | Nine prior groups passed |
| `node tests/browser/campaign-evaluation.mjs` | Eleven evaluation groups passed; **36 total browser groups**, run sequentially with isolated fixtures |
| `node scripts/test-database-v21.mjs` | Disposable PostgreSQL: 100 pgTAP assertions and three concurrency races passed; no active reset |
| `node scripts/test-supabase-v21.mjs` | Fourteen local groups passed; 865 catalog matches, zero deviations; documented columns and generated types still agree |
| `npm.cmd run lint`, `npx.cmd tsc --noEmit --pretty false` | Passed |
| `npm.cmd run build` | Passed with access to existing Google Fonts |
| `node tests/integration/discussion-production.mjs` | All twelve production page/API checks return 404 |
| Render checks | Actual 1440/390/320 screenshots inspected; no horizontal overflow; Impeccable detector reports no findings |

Repeated local fixture setup was verified to reuse valid records without changing history. Test-owned campaigns are closed; immutable evaluation/source/cost history is retained for review. Existing Slices 1–6 assertions were preserved. Private credentials and browser profiles/screenshots remain outside source control. Existing invariant tests run payment/memory examples only on their disposable database; the Slice 7 application creates neither.

## 10. Security and data quality

Actual owner A/B JWTs prove foreign campaign/evaluation/cost access is denied; authenticated callers cannot directly invoke the service-only evaluation RPC. SQL append-only triggers reject mutation of an existing evaluation. UUID replay and payload conflict tests prove history is not duplicated or overwritten. Failed FK persistence leaves no evaluation row.

Stale campaign versions/hashes are rejected before save, post-provider checklist changes prevent persistence, cost changes reset review, and a demonstrated post-preflight race is explicitly labeled stale rather than hidden behind a false CAS claim. A reviewed snapshot cannot fabricate its actor/timestamp or narrative availability. The future C6 consumer rejects mismatched IDs/windows/versions, stale timestamps, invalid metric bounds and duplicate financial-scope IDs.

Authoritative SQL baseline, reported ledger data, blueprint assumptions, synthetic C6 observations and unavailable values are separately represented. No production analytics are reconstructed from raw orders and no hypothetical price/revenue is relabeled as actual sales. The original baseline migration SHA256 remains `1B3612E0DA1FB181C9ABBDD70D13B7A6BB35C4A21D93195F479E86E1B1C8617A`; active schema still has the same 26 tables/351 columns/39 public-private functions.

## 11. Finalization status

**Actual closed→completed transition is not implemented because no approved atomic operation exists.** `record_campaign_evaluation` inserts a row; it does not complete the campaign or validate expected source/revision versions. Its existing `final` checks do not establish authoritative C6 provenance or coordinate all mutable task/cost writers.

No combination of independent RPC + PATCH calls is substituted. All application-generated evaluations remain provisional, every finalization result is ineligible, and a direct authenticated local request is rejected with 409 after ownership/input checks. Existing constraints and lifecycle history remain intact.

A separately authorized database task must design the atomic evaluated save/finalize contract, current evaluation/source checks and coordinated task/cost guards. Production completion must additionally require authoritative C6 completeness/operational resolution and reviewed costs. Current SQL does not provide a separately approved synthetic-completion contract either. Details and affected responsibilities are in the gap document.

## 12. Remaining blockers and limits

- **Database:** atomic finalization, coordinated writes and database source/latest-evaluation revision CAS require separate permission/work. Current append-only review snapshots are independent reports, not a linear CAS revision system.
- **C6:** campaign analytics producer is a development adapter; the authoritative campaign/window/cohort/ledger reader must come from Indro. Unavailable and provisional cases remain explicit.
- **C1:** production business/order/fulfillment facts remain owned by Rafi; their operational-completeness integration is not implemented here.
- **Gemini:** Fake Evaluation is the only active provider. Actual inference/model configuration/transport verification remains separate.
- **Costs/history:** development reads are bounded to 100 cost records, latest 20 supported evaluations and 100 campaigns; production pagination is not added. Existing unsupported evaluation contracts are counted and preserved instead of reinterpreted as this version.
- **Review/correction:** narrative review is an append-only owner confirmation; no arbitrary edit of monetary facts or in-place financial/evaluation overwrite is supported. Void/replacement are explicit separate actions.
- **Execution:** stored completion/version fields and evaluation snapshots provide recorded state; no new task audit-event stream or verified third-party posting evidence is invented.

## 13. Slice 8 handoff

`evaluationHandoff(row, currentHash)` rebuilds the stored context at its original facts timestamp, verifies its hash, validates deterministic recalculation and narrative guardrails, and exposes business/campaign/evaluation identity, published blueprint/strategy, result/provenance, recorded costs/completeness, task versions/completion, findings/recommendations, review audit, explicit campaign/preorder/item/blueprint/task/cost/C6 source versions, source hash/timestamps, limitations and finalization state.

`productionEligible` is explicitly false for every record produced here. Exclusions include provisional evaluation, synthetic provider/data, incomplete campaign finalization, missing owner review and stale source where relevant. Review alone does not make a record final or production-memory eligible.

Before Slice 8 may create production candidates, a separate task must supply authoritative reviewed final evaluation and completion semantics, source freshness/completeness policy and explicit owner memory approval. No memory row, embedding, approval job or retrieval feature was created in Slice 7. Stop for review at this boundary.
