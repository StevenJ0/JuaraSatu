# Slice 6 — Campaign Publishing, Lifecycle & Execution Planner

Verified against local Campaign Lab on 3–4 November 2026 (Asia/Jakarta). This delivers actual Supabase publication, checklist persistence and closing, using an explicitly synthetic business context. No database schema/migration/RPC/grant changes were made in this slice. No commit, push, deploy or remote database operation was performed.

## 1. Implementation result

The owner opens a persisted approved blueprint, reviews current publication eligibility, explicitly publishes it, views its approved calendar/content, completes or reopens manual checklist items, copies a caption, reloads persisted progress and explicitly closes publication. Auth, RLS, baseline capture, task writes and lifecycle state are real local PostgreSQL operations. Fake providers are used only upstream to prepare the source strategy/blueprint; execution never regenerates the approved plan.

`draft → published → closed` is implemented. This slice never marks a campaign `completed`, creates evaluation/memory, creates orders/payments or publishes to social platforms.

The latest Slice 6 instruction assigns publication/lifecycle to Steven and requests a published-offer C3 producer for Indro. Older PRD/team-plan labels assign parts of publication to Indro and describe C3 as the approved-blueprint handoff. This implementation follows the explicit Slice 6 ownership and exposes a separate versioned published-offer projection; it does not edit those documents or implement C8.

## 2. Files created or changed

| File | Responsibility |
| --- | --- |
| `src/features/campaign-execution/contracts.ts` | Strict action schemas, lifecycle/task/content projections, actual publication baseline, C3 result and execution view |
| `src/features/campaign-execution/projections.ts` | C2-based C3 pricing and chronological eligibility, approved materialization checks, Jakarta calendar, progress and task CAS disposition |
| `src/features/campaign-execution/service.ts` | Publish eligibility, provenance/fact validation, duplicate reconciliation, task updates and close orchestration |
| `src/features/campaign-execution/repository.server.ts` | JWT-scoped reads, existing RPC adapters, conditional task update and SQL error classification |
| `src/features/campaign-execution/published-offer.server.ts` | Narrow C3 reader; distinguishes absent, invalid and unavailable sources |
| `src/features/campaign-execution/index.ts` | Public schemas, types and domain/service functions |
| `src/features/campaign-execution/components/execution-workspace.tsx` | Owner list, explicit publication/close confirmation, calendar/checklist, content copying and refresh |
| `src/features/campaign-execution/components/execution.css` | Existing green/cream visual conventions, responsive content, accessible checkbox targets and native progress styling |
| `src/features/campaign-execution/api.server.ts` | Development/auth/origin/input boundaries and GET/POST action dispatch |
| `src/app/api/dev/campaigns/route.ts` | Thin GET/POST entry point |
| `src/app/dev/campaigns/page.tsx` | Development-only execution page |
| `src/features/campaign-blueprint/blueprint-domain.ts` | Extract the existing approval financial comparison as `revalidateBlueprintFinancials` for reuse at publication |
| `src/features/campaign-blueprint/workflow.server.ts` | Call that shared check; preserve Slice 5 approval semantics |
| `src/features/campaign-blueprint/index.ts`, `SLICE_5.md` | Export/document the compatible shared financial check |
| `src/features/campaign-blueprint/components/blueprint-panel.tsx` | Link approved blueprints to their publishing/execution screen |
| `src/lib/supabase/transport.server.ts` | Generated-type-constrained PATCH support with representation readback; existing RPC retry policy retained |
| `scripts/prepare-campaign-execution.mjs` | Reproducible, isolated, future-valid local synthetic preorder fixtures using existing tables and `publish_preorder` |
| `tests/fixtures/execution.ts` | Typed domain snapshot/proposal fixture |
| `tests/fixtures/local-campaign.mjs` | Shared real-HTTP preparation of persisted approved campaigns and cleanup of test-owned publication |
| `tests/unit/campaign-execution.test.ts` | 38 new domain/orchestration/source-boundary cases |
| `tests/integration/campaign-execution.test.ts` | Nine real Supabase transaction/JWT/CAS cases |
| `tests/integration/execution-api.mjs` | Six real HTTP groups |
| `tests/browser/campaign-execution.mjs` | Nine Chrome E2E groups, real clipboard and responsive evidence |
| `tests/browser/persistent-discussion.mjs`, `tests/browser/campaign-blueprint.mjs` | Select their original preorder explicitly, preserving every assertion when new preorders exist |
| `tests/integration/discussion-production.mjs` | Also assert the execution page and API GET/POST are unavailable in production |
| `.env.example`, ignored `.env.local` | Explicit `CAMPAIGN_EXECUTION_MODE=synthetic` opt-in; no credentials in template/documentation |
| This file, `docs/examples/slice-6-execution.json` | Handoff and complete synthetic persisted execution snapshot |

No dependency additions. No edits to `docs/schema.md`, PRD, migrations or generated database types in this slice. Preexisting working-tree changes were preserved.

## 3. Publishing architecture

`UI confirmation → /api/dev/campaigns → development guard + GoTrue user + owner membership + Origin + strict DTO → campaignExecutionService → JWT-scoped campaign/approved blueprint/materialization/source reads → current seeded C1/C8 context → shared Blueprint/C2/Simulator validation → publish_campaign RPC → locked baseline + publication → persisted readback`.

Publication requires exact campaign version, active approved blueprint ID/version and context hash. The source generation and assistant message must still contain the actual saved proposal; source message/fingerprint and tenant/preorder match the blueprint. The same financial-snapshot comparison now serves both approval and publication. Catalog price is never substituted for the frozen preorder price, discounts never stack, and unknown costs are not zeroed.

All tasks/contents are checked against the approved blueprint keys, fields and UTC schedule before publication. Campaign offer/window/budget/target must match the approved plan. The current context must be fresh, have valid capacity/cost/date facts, and allow order intake. Publication is immediate only: `starts_at <= now < ends_at`. Future plans remain draft. A competing published campaign is a domain conflict, including when publication races the development context read.

Unavailable authoritative context fails closed. The development reader remains restricted to the two authorized demo businesses, forty-unit empty preorder scenarios, no orders/reservations and no published offer. Published/closed execution reads do not fabricate a new C1/C8 context; they read the frozen persisted plan and publication data.

## 4. Public module contracts

`index.ts` exports:

- Schemas: `PublishCampaignCommandSchema`, `CloseCampaignCommandSchema`, `TaskCommandSchema`, `PublishedOfferSchema`, `ExecutionSnapshotSchema`, `ExecutionViewSchema`.
- Types: `PublishedOffer`, `ExecutionSnapshot`, `ExecutionView`, `ExecutionTask`, `LifecycleCampaign`, `PublishCampaignCommand`.
- Functions: `projectPublishedOffer`, `executionCalendar`, `taskUpdateDisposition`, `assertMaterializedPlan`, `validateCampaignPublication`, `campaignExecutionService`.
- Error: `CampaignExecutionError`.

Explicit server entry points are `readPublishedOffer` in `published-offer.server.ts`, `executionRepository`/`executionDatabaseError` in `repository.server.ts`, and `executionGet`/`executionPost` in `api.server.ts`. C3 consumers should use the server reader rather than importing UI or reading Fake provider output.

```ts
type PublishInput = {
  campaignId: string;
  blueprintId: string;
  expectedBlueprintVersion: number;
  expectedCampaignVersion: number;
  expectedContextHash: string;
  confirm: true;
};
type TaskInput = {
  campaignId: string;
  blueprintId: string;
  taskId: string;
  expectedTaskVersion: number;
  completed: boolean;
};
type CloseInput = {
  campaignId: string;
  expectedCampaignVersion: number;
  confirm: true;
};
```

These snippets explain the exported Zod-inferred contracts; they are not duplicate source definitions. IDs, versions, hashes, booleans and confirmation are runtime validated; unknown privileged fields and client-supplied prices/actor IDs are rejected. Actions use the established 16 KiB body limit. New TypeScript code contains no `any` or suppression directives.

## 5. Database and concurrency boundaries

Reads reuse `business_members`, `businesses`, `products`, `production_capacity`, `preorders`, `preorder_items`, `orders`, `capacity_reservations`, `campaign_ai_sessions`, `campaign_ai_messages`, `ai_generations`, `campaigns`, `campaign_blueprints`, `campaign_tasks` and `campaign_contents`. All business reads use the owner's actual JWT and tenant filters.

| Operation | Actual write | Integrity |
| --- | --- | --- |
| Publish | Existing service-only `publish_campaign` | Locks capacity → preorder/item/product → campaign, validates source/campaign versions and offer/capacity/state, sets published reference/time and baseline together; unique index enforces one published campaign/preorder |
| Checklist | Existing service-role UPDATE grant on `campaign_tasks` | One conditional PATCH filtered by task, business, campaign, published blueprint and expected task version; only `completed_at` changes; existing trigger increments version |
| Close | Existing JWT-owner `close_campaign` | Existing owner verification, locks, expected version and atomic `published → closed` update |

No checklist RPC is missing for this scope: the existing authorized single-row conditional update is sufficient. Tasks can change only on the immutable **published blueprint**, while campaign status is published or closed. Closing preserves that eligibility, so a concurrent close does not invalidate the task command. Draft revision cannot race checklist writes because unpublished task execution is disallowed. Task updates do not increment campaign version.

Publication retries are reconciled against the persisted published blueprint/version/hash and `baseline_json.sourceVersions.campaignVersion`, which witnesses the successfully applied expected version. This is readback of an already committed operation, not a second publish or a freshness bypass. A genuinely new publication always refreshes context.

Checklist desired-state retries preserve the first completion timestamp and do not increment version again. An immediate applied retry is recognized at expected version + 1; older ABA commands conflict. Concurrent identical completion is tested against actual PostgreSQL. Reopen writes null with the same CAS checks.

Close retries are recognized when the current closed campaign is exactly expected version + 1. If unrelated later mutations advance campaign version, an older close command may return a conflict; refresh is authoritative. No history is deleted.

The transport retries only confirmed PostgreSQL serialization aborts matching the existing `could not serialize access` rule. Domain `40001` errors (`VERSION_CONFLICT`, `STALE_FACT_VERSIONS`) are not blindly retried. Remaining transient serialization/deadlock failures map to `DATABASE_BUSY`/503; competing publication maps to `CAMPAIGN_CONFLICT`/409. Network uncertainty uses persisted readback rather than assuming rollback.

## 6. C3 handoff to Indro's C8

The server reader has this actual signature:

```ts
readPublishedOffer(repository, { businessId, preorderId }, now): Promise<PublishedOffer>
```

The repository must be constructed with an authorized server owner scope/user transport. The current transport is explicitly local-only; production authentication/data-access wiring remains a separate integration task.

`PublishedOffer` is versioned with `schemaVersion: 1`. It contains business/preorder scope, `calculatedAt`, state, eligibility, safe reason and a nullable persisted configuration. Configuration includes campaign ID/version/status, published blueprint ID/version, preorder-item ID/version, frozen base price, offer type/bps, C2-computed unit price, starts/ends/published/closed timestamps, context hash, source generation/proposal version and four original source versions.

| State | Meaning / required consumer behavior |
| --- | --- |
| `none` | No campaign was published for this preorder; configuration null |
| `scheduled` | Persisted published configuration is before `max(starts_at,published_at)`; ineligible, no activation write |
| `active` | Valid published configuration inside its time window with published preorder; eligible **only as configuration/time input to C8** |
| `expired` | Time reached `ends_at`, even if stored status is still published; ineligible |
| `closed` | Stored publication ended or preorder is no longer open; ineligible; historical configuration retained |
| `invalid` | Missing/mismatched approved reference, frozen price, baseline, provenance or unsupported configuration; null configuration, never a fallback discount |
| `unavailable` | Data source failed; null configuration, never converted to no campaign |

An active **normal-price campaign** has `state=active`, `offerType=normal_price`, zero bps and the frozen full price. It remains a campaign with its own budget/baseline; it is distinct from `state=none`.

The baseline parser validates the required actual RPC projection and accepts its additional locked-context fields. It does not reject a valid SQL baseline merely because it contains paid units, capacity identifiers or other documented context metadata. C3 validates baseline/source references against the approved publication; later mutable catalog edits never reprice historical published configuration.

**C8 must** check source freshness, actual preorder/cutoff/capacity eligibility, recompute server checkout pricing through C2, respect `eligible=false` and unavailable/invalid states, and retain the pricing-campaign reference for applicable orders. Attribution remains separate. This slice does not implement C8, customer checkout, order reservation or payment and does not prove customers receive this discount.

## 7. Execution planner and lifecycle behavior

The planner uses persisted tasks/contents of `published_blueprint_id` after publication, or the active approved blueprint for preview. It never merges tasks from discarded historical revisions. Limits remain twelve tasks, eight contents and 2,200 characters/content.

The functional timeline groups by calendar day in `Asia/Jakarta`, orders by due timestamp/key, displays campaign start/end and publication/close timestamps, and classifies tasks as completed, overdue or upcoming. UTC remains stored; no automatic date shifts or frontend state transitions occur. Progress is deterministic completed/total/remaining/rounded percentage/overdue count; an empty plan yields zero percent.

Completion and reopening are owner confirmations, permitted while published or closed. Completing a task does not prove a third-party post or additional sales. No execution-notes or completed-by column is invented. Approved captions can be copied through the browser clipboard; denied clipboard access offers manual copying. There is no social API call. The schema relates content to blueprint/channel, not an individual task/date, and the UI states that limitation.

Closing stops C3 eligibility but preserves the frozen blueprint, baseline, task progress, content, costs and audit history. Expiry is chronological eligibility, separate from persisted lifecycle status. There is no durable expiry worker in this slice; an expired row can remain published and still block the next campaign until its owner explicitly closes it.

## 8. Local setup, routes and review fixtures

Keep existing local keys private. The template only contains placeholders:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<local-public-key>
SUPABASE_SERVICE_ROLE_KEY=<server-only-local-key>
CAMPAIGN_DISCUSSION_PROVIDER=fake
CAMPAIGN_DISCUSSION_CONTEXT=seeded
CAMPAIGN_BLUEPRINT_PROVIDER=fake
CAMPAIGN_BLUEPRINT_APPROVAL=synthetic
CAMPAIGN_EXECUTION_MODE=synthetic
```

`node scripts/prepare-campaign-execution.mjs` adds isolated products/capacity/preorders/items under the two existing authorized synthetic businesses and publishes preorders through `publish_preorder`. It never changes an existing historical window or approved blueprint, resets data or creates fake payments. It verifies Docker project/workspace ownership. Current fixture IDs are privately recorded in `node_modules/.cache/campaign-execution/scenarios.json`; a still-valid manifest is reused. When less than two days remain it creates new isolated scenarios and preserves old records.

The verified scenario expires **9 November 2026 at 23:34 WIB**, has cutoff the next day and fulfillment on 12 November. Old Slice 5 preorders remain unchanged. Run Next with `npm.cmd run dev -- --port 3100`.

- Login/source blueprint: **http://localhost:3100/dev/discussion**.
- Owner execution list: **http://localhost:3100/dev/campaigns**.
- Fresh approved, unpublished review campaign: **http://localhost:3100/dev/campaigns?campaignId=272e59f0-6256-42c5-b2e6-c9d9a530b4f9**.
- Its source discussion: `http://localhost:3100/dev/discussion?sessionId=ea562565-4d43-4f1e-bcfc-ae3af83dd17b&campaignId=272e59f0-6256-42c5-b2e6-c9d9a530b4f9`.
- Closed automated example: `http://localhost:3100/dev/campaigns?campaignId=e5a08f15-575d-42fc-82c5-34f7a004edf0`.

Manual flow: log in using the existing private synthetic credentials → open the approved review blueprint → follow **Tinjau publikasi & kalender eksekusi** → review eligibility → check confirmation and publish → inspect WIB days → complete/reopen a task → copy caption → refresh → explicitly confirm close → verify closed state and retained progress. A future source/version change can legitimately make the unpublished example stale; create/approve a fresh source rather than bypassing validation.

API `/api/dev/campaigns`:

- GET: owned approved/publication-history campaign list (latest 100; full eligibility is checked when opened).
- GET `?campaignId=<uuid>`: persisted campaign/approved plan, timeline/progress, eligibility and C3.
- GET `?preorderId=<uuid>`: current/historical published C3 projection for an owned preorder.
- POST `action=publish|task|close`: corresponding strict command and persisted readback.

All responses are no-store. Cookie writes require matching Origin. The execution page/API return 404 in production even when local synthetic flags are present. No production fallback is added.

## 9. Automated verification

| Check | Actual result |
| --- | --- |
| `npm.cmd run test:unit` | **326 passed**, including 38 new Slice 6 cases; previous 288 preserved |
| `npx.cmd vitest run tests/integration` | **26 passed**, including 9 new real Supabase publishing/execution cases |
| `node tests/integration/discussion-api.mjs` | 4 prior HTTP groups passed |
| `node tests/integration/blueprint-api.mjs` | 5 prior HTTP groups passed |
| `node tests/integration/execution-api.mjs` | 6 new HTTP groups passed; 15 total |
| `node tests/browser/persistent-discussion.mjs` | 8 prior browser groups passed |
| `node tests/browser/campaign-blueprint.mjs` | 8 prior browser groups passed |
| `node tests/browser/campaign-execution.mjs` | 9 new browser groups passed; 25 total, including actual clipboard readback |
| `node scripts/test-database-v21.mjs` | Disposable PostgreSQL 17: both existing migrations compile, 100 pgTAP assertions and 3 existing concurrency races passed; active DB was not reset |
| `node scripts/test-supabase-v21.mjs` | 14 local groups passed; 865 catalog matches, zero deviations; 351 documented columns/types and generated types still agree |
| `node scripts/prepare-campaign-execution.mjs` again | Existing valid fixture reused; history unchanged |
| `npm.cmd run lint` | Passed |
| `npx.cmd tsc --noEmit --pretty false` | Passed |
| `npm.cmd run build` | Passed; existing Google Fonts require network access |
| `node tests/integration/discussion-production.mjs` | All 9 production checks return 404, including execution page/API |
| UI verification | Actual screenshots inspected; 1440/390/320 widths have no horizontal overflow; Impeccable detector returns no findings |

Additional `git diff --check` reported preexisting Markdown trailing spaces/EOF formatting in the already-modified PRD/schema files. Those unrelated/read-only documents were left untouched; this is separate from the passing ESLint/typecheck/build results.

The first combined browser run exposed fixture contention: older suites selected the newest preorder, while Slice 6 published it. Tests now explicitly select their original fixture and the final browser suites ran sequentially. Every existing assertion remains. A fresh-page tenant B login also waits for hydration before entering credentials.

Screenshots, private credentials/manifests and raw run snapshots remain ignored under `node_modules/.cache/`; browser profiles are outside the watched workspace. The complete synthetic closed execution snapshot is [documented here](../../../docs/examples/slice-6-execution.json).

## 10. Security and data-integrity evidence

Real GoTrue owner A/B JWTs prove foreign campaign/execution reads and commands are denied. An owner JWT cannot directly PATCH a task or invoke the service-only publish RPC. Server task writes filter tenant/campaign/immutable published blueprint/expected task version and cannot mass-assign arbitrary client fields. No service key or token is returned or logged.

Actual concurrency tests prove identical publish requests yield one publication/version/baseline, competing campaigns yield one winner, and rejected publication leaves the other draft without baseline/published pointer. Actual stale-source SQL tests run inside a rolled-back transaction and assert no partial publication. HTTP source mutation tests change only the known synthetic product, restore its price and retain the correctly incremented source versions; frozen preorder prices never change.

Actual task tests prove duplicate concurrent completion increments one task version, preserves its first timestamp, reloads from PostgreSQL, supports reopening and rejects older ABA payloads. Close tests prove retained tasks/content/baseline and ineligible C3 with `completed_at = null` and no evaluation row. These guarantees do not rely on fake repositories.

Test-owned publications are closed during cleanup; immutable local source/campaign/history records remain for review rather than deleting business history. Existing data and previous approved blueprints are not overwritten. The original migration hash remains `1B3612E0DA1FB181C9ABBDD70D13B7A6BB35C4A21D93195F479E86E1B1C8617A`; both migrations, 39 public/private functions, RLS and grants remain unchanged.

## 11. Remaining limitations

- Production C1 availability/cost/cutoff producers are not connected; publication uses only the explicitly opted-in consistent local seeded reader.
- C8/checkout is not implemented. C3 eligibility is a configuration/time projection, not a reservation, checkout authorization or proof of customer discounts.
- C6 production KPI/analytics is not connected. Baseline comes from actual SQL paid-unit counting (zero for these empty fixtures); it is not Fake AI data. No sales uplift is inferred.
- Real Gemini inference was not invoked, reconfigured or verified in this slice. Source strategies/blueprints remain visibly synthetic.
- There is no automatic expiry transition/worker or social posting. Owners explicitly close expired published rows.
- Lists are bounded to the latest 100 development records; production pagination is deferred. Current approved blueprint contracts support the existing WhatsApp/Instagram plan shape.
- Closed-task editing remains intentionally supported. A future finalization command that makes tasks immutable must coordinate its lock/version policy with checklist writes; this slice adds no completed/evaluation transition.
- No schema/RPC blocker remains for the requested local workflow, and no additional database permission was requested.

## 12. Slice 7 readiness

Persisted published/closed campaigns now expose the published approved version, actual publication baseline/timestamps, offer snapshot, task versions/completion and approved content as inputs for a separate Evaluation task. The C3 interface is ready for Indro's C8 adapter work, with the consumer obligations above.

Production evaluation still requires C6's authoritative cohort/financial/completeness snapshots and explicit finalization policy. Planning targets, manual checklist completion and synthetic scenario contribution must never be passed off as actual sales or causal impact. No Slice 7 evaluation, campaign completion or Business Memory work was started.
