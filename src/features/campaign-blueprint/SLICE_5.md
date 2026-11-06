# Slice 5 — Campaign Blueprint, Revision & Approval

Verified locally on 3 November 2026. Auth, PostgreSQL persistence, JWT tenant checks and transactions are real. Strategy/Blueprint providers and the business context adapter are explicitly synthetic. No publishing, execution tracking, calendar, evaluation or RAG is implemented here.

## 1. Result and scope

An owner can select a saved Stage 4B alternative, atomically create its campaign draft and first blueprint, review/edit the plan, save immutable numbered revisions, explicitly approve the current version and reload the result from PostgreSQL. Approval materializes the active version's tasks and contents; the campaign remains `draft` with `published_at = null`.

The existing database RPCs could not create the parent and initial sourced blueprint in one transaction. The user explicitly authorized **one additional RPC**, `create_campaign_with_initial_blueprint`. Its additive migration is applied only to local `campaign-lab`; no table, column, baseline function or original migration changed. Permission and rationale: [RPC gap](../../../docs/plans/slice-5-rpc-gap.md).

## 2. Files added or changed by this slice

| File | Responsibility |
| --- | --- |
| `contracts.ts` | Zod DTOs for selection, plan, edits, persisted blueprint, database projections and provider input/output boundary |
| `blueprint-domain.ts` | Source fingerprints, proposal freshness, offer/capacity/date/content validation and C2/Simulator recalculation |
| `blueprint-service.ts` | Bounded generation command, campaign/parent CAS, provider validation and context reread |
| `development-provider.ts` | Explicitly opted-in Fake Blueprint; normal/discount/channel-sensitive plans and failure/invalid scenarios |
| `repository.server.ts` | JWT-scoped source/history reads, privileged single-RPC writes, safe error mapping and duplicate reconciliation |
| `workflow.server.ts` | Create/revise/approve orchestration and explicit approval freshness checks |
| `api.server.ts` | Authentication, origin/size/input checks, HTTP mapping and development guards |
| `index.ts` | Public pure domain exports |
| `components/blueprint-panel.tsx`, `components/blueprint.css` | Existing discussion page's full preview, edits, history and explicit approval |
| `src/app/api/dev/blueprints/route.ts` | Thin GET/POST route exports |
| `src/features/campaign-strategist/components/discussion-workspace.tsx` | Mount panel; clear a prior campaign selection when switching discussions |
| `src/features/campaign-strategist/discussion-api.server.ts` | Reuse bounded-body decoder with optional byte limit; Stage 4B retains its original limit |
| `src/features/campaign-strategist/development-context.server.ts` | Preserve actual PostgreSQL timestamp precision in seeded source dates |
| `src/features/ai-context/contracts.ts`, `src/lib/supabase/timestamps.ts` | Shared UTC normalization retaining microseconds through repeated context parsing |
| `supabase/migrations/20261103090000_atomic_campaign_blueprint_creation.sql` | The one authorized atomic creation RPC; service role only |
| `src/lib/supabase/database.types.ts` | Regenerated with local CLI after the additive migration |
| `scripts/test-database-v21.mjs` | Disposable database verifier applies all sorted active migrations |
| `tests/fixtures/blueprint.ts`, `tests/unit/campaign-blueprint.test.ts` | Typed fixtures and 22 focused domain cases |
| `tests/unit/supabase-timestamps.test.ts`, `tests/unit/ai-context.test.ts` | Timestamp normalization and context precision regression checks |
| `tests/integration/campaign-blueprint.test.ts` | Eight actual Supabase transaction/JWT cases |
| `tests/integration/blueprint-api.mjs` | Five actual Next HTTP groups, including changed PostgreSQL facts |
| `tests/browser/campaign-blueprint.mjs` | Eight Chrome E2E groups and desktop/mobile screenshots |
| `tests/browser/persistent-discussion.mjs` | Preserve existing assertions; put Chrome profile outside watcher and wait for enabled controls |
| `tests/integration/discussion-production.mjs` | Also assert blueprint GET/POST return 404 in production |
| `.env.example`, local ignored `.env.local` | Two explicit Blueprint opt-in flags; no credentials in documentation/template |
| `docs/plans/slice-5-rpc-gap.md`, this file, `docs/examples/slice-5-blueprint.json` | Authorized RPC explanation, handoff and complete synthetic example |

Paths in the first ten rows are relative to this directory. Existing PRD/schema/package/lockfile changes predate this slice and were preserved. No dependencies were added.

## 3. Architecture and provenance

`UI → development Route Handler → GoTrue authentication + owner membership → Zod/origin checks → workflow → JWT repository reads → context/C2/Simulator/provider validation → server-only transactional RPC → JWT readback → UI`.

The browser submits `{ sessionId, generationId, proposalVersion, proposalKey }`, never an authoritative proposal object. The repository checks the owned session/preorder, successful generation, matching assistant message, saved proposal state and identical persisted proposal JSON in generation/message. It binds the selected alternative to the actual option. Blueprint JSON pins message/session/generation/key/version, a normalized proposal fingerprint, four source versions and context hash.

Generation rereads context after provider output. Approval rereads the persisted source and current context, validates offer/dates/capacity/tasks/contents and recalculates financial numbers before calling SQL. Unavailable context fails closed; history can still be read, with `currentHash = null` and approval blocked.

## 4. Actual public contracts

The feature `index.ts` exports:

- Schemas: `CampaignBlueprintSchema`, `BlueprintPlanSchema`, `BlueprintEditsSchema`, `SelectionSchema`, `BlueprintRowSchema`, `CampaignRowSchema`, `RevisionCommandSchema`.
- Types: `CampaignBlueprint`, `BlueprintPlan`, `BlueprintEdits`, `PersistedSelection`, `Selection`, `BlueprintProvider`.
- Functions: `validateBlueprint`, `validateBlueprintOffer`, `validateSelectedProposal`, `initialBlueprintEdits`, `generateBlueprint`; Slice 6 also exposes `revalidateBlueprintFinancials` for the same approval/publication financial check.
- Error: `BlueprintError`.

Server entry points remain in explicitly named server files: `blueprintWorkflow`, `CreateBlueprintCommandSchema`, `ApproveBlueprintCommandSchema`, `blueprintRepository`, `blueprintGet`, `blueprintPost`. The provider exposes `developmentBlueprintProvider` and `blueprintDevelopmentEnabled`.

`BlueprintProvider.generate({ alternative, edits, now }): Promise<unknown>` is a small provider contract; its response must parse as `BlueprintPlanSchema`. Pricing, identity, provenance, versioning and KPI fields are assembled by application code. TypeScript is strict and the new feature contains no `any` or suppression directives.

Bounds: one to twelve tasks, one to eight contents, captions up to 2,200 characters, unique keys, supported WhatsApp/Instagram channels, validated UTC scheduling and positive fulfillable unit assumptions. Free caption text currently rejects numeric prices/percentages and unsupported promotions/guarantees; the structured offer remains the source of price. Manual plan overrides are validated exactly like generated output.

## 5. Actual database integration

Reads use owner JWT + RLS: `business_members`, `businesses`, `products`, `production_capacity`, `preorders`, `preorder_items`, `orders`, `capacity_reservations`, `campaign_ai_sessions`, `campaign_ai_messages`, `ai_generations`, `campaigns`, `campaign_blueprints`, `campaign_tasks`, `campaign_contents`.

Writes use the existing trusted server transport, only after scoped user reads:

| Operation | RPC | Transaction boundary |
| --- | --- | --- |
| Initial draft + blueprint | `create_campaign_with_initial_blueprint` | Owner/source/version checks, command advisory lock, existing `save_campaign_draft` + `save_blueprint_revision` in one transaction |
| New blueprint revision | `save_blueprint_revision` | Campaign CAS, immutable next version, prior approval invalidation, active pointer |
| Explicit approval | `approve_blueprint` | Fact/campaign locks and versions, approval audit, campaign offer projection, tasks and contents together |

No publication RPC is called. No use of `campaigns.baseline_json` for provenance. The new wrapper supplies the SQL NULL initial expected version internally; CLI-generated TypeScript arguments need no unsafe nullable cast.

Actual catalog after addition: 26 tables, 351 columns, 288 constraints, 100 indexes, 25 policies, 34 triggers and 39 public/private functions. Original baseline migration SHA256 remains `1B3612E0DA1FB181C9ABBDD70D13B7A6BB35C4A21D93195F479E86E1B1C8617A`.

## 6. Complete synthetic example

[Full validated blueprint JSON](../../../docs/examples/slice-5-blueprint.json) was captured from the successful browser run. Its local IDs and timestamps describe an example snapshot; it is documentation, not an API create payload or a portable seed.

- Campaign: **Pengingat preorder sintetis**, blueprint v3, campaign v6, approved at `2026-11-03T15:19:47.039113+00:00`, still draft/unpublished.
- Objective: review hypothetical additional paid units without promising results. Approach: `limited_discount`; audience interest is an unverified hypothesis; channel: WhatsApp.
- Frozen base/current effective price: Rp120,000. Discount: 500 bps (5%), applied once to frozen base, producing Rp114,000.
- Verified variable cost/unit: Rp75,000. Assumption: six additional units from forty available; promotion budget Rp20,000.
- Scenario revenue: Rp684,000; variable cost: Rp450,000; contribution after promotion: Rp214,000. These are estimates, not actual sales or causal uplift.
- Window: 3 Nov 2026 07:21 WIB to 4 Nov 2026 08:21 WIB. KPI: `paid_units_in_window`, target six; actual metrics are null and publication baseline remains unavailable.
- Tasks: manually review/share announcement (3 Nov 23:19 WIB), reminder (4 Nov 05:21 WIB), extra follow-up (4 Nov 06:51 WIB). Exact UTC timestamps, keys and descriptions are in the JSON.
- Caption: “Penawaran diskon preorder tersedia. Lihat rincian harga, ketersediaan, dan batas waktu pada tautan preorder. Tinjau sebelum memesan.”
- Risks: unknown audience response and reduced contribution/unit. Dependencies: production producers and publishing are not connected. Checklist requires reviewing offer, availability, every task and caption. Evaluation plan explicitly avoids claiming causality.

For unknown variable costs, unavailable contribution metrics stay null; unsupported discount assumptions are rejected by C2 rather than treating unknown cost as zero.

## 7. Revision, approval, concurrency and retry rules

Creation stores proposed blueprint v1 and advances campaign version to 2. Revision creates v2 and advances campaign version; explicit approval projects its offer and advances campaign version again. A subsequent revision discards the prior approved blueprint and selects the new proposed version. Historical task/content rows remain attached to their original blueprint; read/materialization counts refer to the active blueprint only.

Before approval, campaign offer columns may still reflect the previous draft/approved projection; the **active blueprint** contains pending revisions. Callers must require the active blueprint to be approved before using a campaign for publication. The UI previews the active blueprint, not stale campaign offer columns.

Every create/revision uses a stable request UUID as blueprint UUID plus a normalized request/source fingerprint in the approved blueprint JSON. Matching replay returns persisted state; different payload reuse conflicts. Concurrent duplicate creation serializes in SQL. Revision retries reconcile by the immutable blueprint UUID after a conflict or uncertain response. There are no independent parent/child writes and no compensating delete.

Approval requires exact active blueprint ID/version and explicit `confirm: true`. The existing RPC's already-approved fast path skips expected versions, so application provenance/context/financial validation happens even on approval replay. Old blueprint approval and stale revision CAS are rejected. An uncertain approval response can safely be retried; there is no blanket network retry.

The existing approval RPC does not rename campaigns. This slice keeps the selected initial campaign title read-only rather than adding another database change. Goal, caption/plan, financial assumptions, supported offer, window, channels and notes can be revised through the validated command. The minimal UI exposes goal, first caption, discount, units, budget and bounded Fake revision notes; the API supports the full validated plan/window/channels.

## 8. Local configuration and manual flow

Local project `campaign-lab`: API `http://127.0.0.1:54321`, database port 54322. Use existing local Supabase keys privately; never print or commit `.env.local`.

```dotenv
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<local-public-key>
SUPABASE_SERVICE_ROLE_KEY=<server-only-local-key>
CAMPAIGN_DISCUSSION_PROVIDER=fake
CAMPAIGN_DISCUSSION_CONTEXT=seeded
CAMPAIGN_BLUEPRINT_PROVIDER=fake
CAMPAIGN_BLUEPRINT_APPROVAL=synthetic
```

Run `npm.cmd run dev -- --port 3100`; open **http://localhost:3100/dev/discussion**. The integrated API is `/api/dev/blueprints`:

- GET `?sessionId=<uuid>` lists saved alternatives with current eligibility.
- GET `?campaignId=<uuid>` returns campaign, active blueprint, version history, active materializations and current hash.
- POST discriminated actions `create`, `revise`, `approve`, each using its strict schema. Body limit is 65,536 bytes; cookie writes require matching Origin. No external AI calls occur.

Manual steps:

1. Log in with the documented synthetic local owner credentials, stored privately in `node_modules/.cache/database-v21-cutover/fixture-credentials.json`.
2. Create/open an owned discussion; generate a fresh strategy. Old proposals can be stale after source versions or timestamp precision changed.
3. Click **Muat ulang blueprint/sumber**, then **Buat campaign draft & blueprint** for an eligible saved alternative.
4. Review all facts, hypothetical prices/budget/units, dates, KPI, tasks, captions, assumptions and risks.
5. Edit fields or use Fake revision notes **Tambahkan pengingat akhir**, select replan when desired, and save a new revision. Failure/invalid provider scenarios preserve the prior saved version.
6. Check the explicit confirmation, then approve the displayed version. Verify approved audit, active task/content counts and campaign draft status.
7. Reload the URL containing both sessionId and campaignId; the saved version/approval must return. A revision after approval requires approval again.

The verified review example is at:
`http://localhost:3100/dev/discussion?sessionId=0381bcef-13df-47ca-9276-faed3f874ad5&campaignId=3a4f152a-b35b-477d-b250-302d988f60dd`.

Seed windows expire at their actual database time; this slice never moves dates or resets data to bypass expiry. After expiry, history remains readable but new generation/approval fails safely; preparing a new consistent fixture is a separate operation. Earlier HTTP examples may also be stale after deliberate version-change tests.

## 9. Verification actually executed

| Command/check | Result |
| --- | --- |
| `npm.cmd run test:unit` | 288 passed: 262 previous + 22 Blueprint + 3 timestamp + 1 context precision regression |
| `npx.cmd vitest run tests/integration` | 17 passed, including 8 new actual Supabase Blueprint cases |
| `node scripts/test-database-v21.mjs` | Both active migrations compile on disposable PostgreSQL 17; 100 existing pgTAP assertions and 3 concurrency races passed |
| `node scripts/test-supabase-v21.mjs` | 14 local integration/catalog groups; 865 MATCH, zero deviations; all 351 documented columns and generated types verified |
| `node tests/integration/discussion-api.mjs` | 4 Stage 4B HTTP groups passed |
| `node tests/integration/blueprint-api.mjs` | 5 Blueprint HTTP groups passed |
| `node tests/browser/persistent-discussion.mjs` | All 8 previous browser groups passed |
| `node tests/browser/campaign-blueprint.mjs` | 8 Blueprint browser groups passed, including refresh, failed/stale approval and reapproval |
| `npm.cmd run lint` | Passed |
| `npx.cmd tsc --noEmit --pretty false` | Passed |
| `npm.cmd run build` | Passed with network access for existing Google Fonts; initial sandbox-only build could not download fonts |
| `node tests/integration/discussion-production.mjs` | All 6 production checks return 404, including Blueprint GET/POST despite local Fake flags |
| UI inspection | Screenshots inspected at desktop and mobile; 1440/390/320 widths have no horizontal overflow; Impeccable detector returns no findings |

Docker/Chrome and font-download commands require the corresponding local execution access. Tests use only local synthetic data, never real Gemini or remote services. No test resets the active database. Test-created sessions/campaigns are isolated UUID records; persisted audit examples/history are retained locally for review, with no blanket cleanup/deletion of business data. Negative temporary approval fixtures are inside rolled-back SQL transactions; deliberate synthetic catalog-price changes are restored, while their incremented source versions correctly remain changed.

Screenshots and raw browser/HTTP example snapshots are ignored under `node_modules/.cache/campaign-blueprint/`. Chrome profiles are created outside the watched workspace to avoid continuous Turbopack reloads. The existing browser assertions were preserved.

## 10. Security and integrity evidence

- Real owner A/B GoTrue JWTs: foreign session/proposal/campaign reads are 404; cross-tenant creation and approval are denied. Authenticated JWT callers cannot directly invoke the new service-only RPC.
- Auth/membership comes from the server, not client actor/business fields. Cookies remain HttpOnly. Client bundles contain no service-role key.
- Strict request/provider/database validation, bounded body/array/text sizes and explicit development-only configuration. No production route silently uses Fake AI; generation is bounded local deterministic work.
- Financial numbers are recalculated with Simulator/C2 from frozen preorder prices; discount stacking and capacity/cost violations are rejected. Captions cannot override structured prices or invent unsupported offers.
- PostgreSQL rollback tests assert failed initial child validation leaves neither parent nor blueprint. Failed approval after duplicate-content constraint leaves no approval flag, campaign projection or task/content partial writes.
- Actual changed product facts cause HTTP approval to return `STALE_CONTEXT` without materialization. Context read failure also prevents approval.
- The timestamp regression was caught by actual campaign SQL guards: millisecond truncation moved a valid start before its PostgreSQL microsecond boundary. Shared normalization now preserves precision; database guards remain unchanged.

## 11. Remaining limitations

- C1 remains the explicitly authorized two-business, empty-preorder seed reader; it checks real rows/versions but is not a production availability producer. Orders/reservations/active published campaigns make that adapter fail rather than fabricate facts.
- C6 actual KPI is unavailable. C8 is explicitly synthetic no-active-offer context, not a production published-offer resolver. Production approval awaits proper authoritative producers.
- Blueprint generation is deterministic Fake AI; revision notes have bounded template behavior. Real Gemini inference was not tested or changed.
- Campaign renaming is unavailable here because the existing atomic approval API does not project name; no second schema/RPC expansion was attempted.
- History/source selectors are bounded to the latest 100 records for this development workflow; production pagination is a separate concern.
- Free numeric caption text is intentionally restricted; structured numeric rendering would need a separately validated contract.
- No remaining RPC blocker for the requested local workflow after the single authorized addition. `docs/schema.md`, original migration and all existing RPC definitions remain untouched by this slice.

## 12. Slice 6 readiness

The local approved active blueprint, its provenance, audit, campaign offer projection and materialized plan are ready for a **separate Campaign Publishing task** to consume. That task must revalidate current facts, require the active approved version, use the existing publication transaction and keep publication baseline/actual activation rules separate from approval.

This is **local workflow readiness only**. Production C1/C8 integration and real provider verification remain pending. No publication endpoint/button, execution tracking, close/completion, calendar, evaluation or RAG was added. No commit, push, deploy, remote mutation or destructive reset was performed.
