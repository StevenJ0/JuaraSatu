# AI Business Context Builder — Slice 3

Owner: Steven. Pure Node/TypeScript module; no database, Gemini, routes, prompts,
chat persistence, or vector retrieval. Fixtures exist only in `tests/fixtures`.
There is no production reader implementation or successful fixture fallback.

## Public API

Import from `@/features/ai-context` in server-side Node code:

```ts
buildBusinessContext(input: unknown): ContextBuildResult
```

Public runtime schemas: `BuildBusinessContextInputSchema`, `CampaignContextV1Schema`,
`C1ContextSnapshotSchema`, `C6ContextSnapshotSchema`, `C8ContextSnapshotSchema`.
Corresponding inferred types plus `ContextBuildResult`, `ContextBuildError`,
`ContextReadScope`, and `BusinessContextReaders` are exported by `index.ts`.
Hashing stays internal. No new dependency is needed (`node:crypto` + existing Zod).

Result: `{ success: true, data: CampaignContextV1 }` or
`{ success: false, errors: [{ code, source, field, message }] }`.
Errors never echo raw source values or provider error messages.

## Reader handoff

These schemas are minimal consumer projections to agree with producers, not
existing producer implementations or database row definitions. Readers return
`{ status: "available", data }` or `{ status: "unavailable", reason }`;
reason is `not_implemented | read_failed | not_found | forbidden`.
`BusinessContextReaders` declares `readC1/readC6/readC8(scope)`; it does not fetch.

| Producer | Exact required projection |
|---|---|
| C1 / Rafi | `business`: businessId, name, category, description, locationContext. `product`: businessId, productId, name, category, description, catalogUnitPriceIdr, variableCostIdr, costQuality. `preorder`: businessId, productId, preorderId, preorderItemId, preorderName, baseUnitPriceIdr, targetUnits, quotaUnits, paidUnits, heldUnits, allocatedUnits, orderableUnits, preorderStatus, startsAt, endsAt, intakeCutoffAt, fulfillmentDate. `snapshot`: provenance, calculatedAt, preorderVersion, preorderItemVersion, capacityVersion, productVersion. |
| C6 / Indro | businessId, preorderId, preorderItemId, productId. `metrics`: paidUnits, fulfilledUnits, validOrderValueIdr, fulfilledSalesValueIdr, productionCostIncurredIdr, campaignSpendActualIdr, estimatedContributionIdr, costsComplete, isProvisional, isSandboxData. `snapshot`: C1-compatible source versions/provenance/time + metricsSchemaVersion=1. This slice consumes preorder aggregates; campaign-window analytics is not reimplemented here. |
| C8 / Indro | businessId, preorderId, preorderItemId, productId, baseUnitPriceIdr. `effectiveOffer`: state, offer, unitPriceIdr, campaign. `snapshot`: provenance, calculatedAt, preorderVersion, preorderItemVersion, offerVersion. |

C1 `baseUnitPriceIdr` means **preorder_items.base_price_snapshot_idr**. Catalog
price is validated at the input boundary, omitted from the AI projection, and
never used for current/hypothetical pricing. C1 owns effective hold/allocation
accounting and shared-capacity calculations; paid units are already included in
allocated units. Builder only checks the quota upper bound, not reservation SQL.

`locationContext` and product `category` are nullable AI-approved descriptive
context. The target schema has no dedicated columns for these two fields:
return null when no approved source exists; do not invent columns or infer an
address/category from private contact information. Business category remains
the documented business category.

C8 `state=none` requires an explicit normal-price offer, frozen unit price, and
campaign=null. `state=active` supports normal-price or percent-discount offers
and requires campaignId, businessId, preorderId, version, status=published,
startsAt, endsAt, publishedAt. An unavailable read is never converted to `none`.
C2 verifies the returned unit price. C8 still owns resolving eligibility;
the builder validates its returned claim, scope, versions, and window.
Current offer is not invalidated by reapplying today's cost policy to it.

## Input policy and freshness

Caller supplies server-authorized `{ businessId, preorderId }` as `scope`, a
trusted `calculatedAt`, explicit `maxSourceAgeSeconds` (1..86,400),
`analyticsRequirement=required|optional`, the three producer reads,
`hypotheticalScenario` (ScenarioInput or null), and `history`.
The fixture's 60 seconds is a test policy, not an agreed production TTL.

C1 and C8 are required. Past snapshots beyond max age and future snapshots fail.
IDs must match across business/product/preorder/item/campaign and requested scope.
Versions/provenance must be coherent; mixed fixture/server sources fail. An active
offer past its window fails even within the age limit. Intake eligibility is
derived from status and the explicit request clock using `[startsAt, endsAt)`.

C6 optional unavailable/stale/incompatible-version-or-paid-count snapshots become
explicit unavailable analytics, without their metrics. Required C6 fails instead.
Cross-tenant IDs, malformed data, mixed provenance, and `forbidden` always fail;
they are not optional missing data. Source metadata is retained for diagnosis.
No source errors are silently replaced with zero KPIs.

Readers must agree on version semantics/as-of consistency. Matching counters and
an age threshold do not prove a transactionally consistent SQL snapshot. Production
must authorize tenant ownership before reading, use authoritative server/DB time,
read fresh availability, and revalidate at approval/publish. Hash equality does
not authorize access, reserve capacity, or replace concurrency controls.

## Context semantics and minimization

Context contains current business/product/preorder facts, an effective offer,
separate actual analytics, an optional hypothetical scenario, reserved history,
constraints, and metadata. Target gap is max(target-paid,0), independent of
orderable units. Unknown variable cost and unknown monetary KPIs stay null;
confirmed zero stays 0. Incomplete actual costs cannot carry a numeric final
contribution. Monetary bounds reuse C2 (IDR integers up to Rp1 billion, signed
contribution within +/-Rp1 billion); larger producer totals are rejected.

An optional scenario is parsed with the public simulator schema and computed by
the existing pure simulator/C2. Only its input, numeric summary, feasibility,
warnings, and blockers are projected. Over-capacity or financial-policy failures
remain explicitly infeasible what-if results; they never replace live facts.
Uncomputable/overflow results fail with INVALID_SCENARIO. No quantity is a forecast.

Named descriptive/aggregate projection objects strip unknown keys; existing shared
strict schemas reject unexpected fields instead. Only named AI-approved
business/product text and aggregate facts survive; no orders/customer contacts,
tracking tokens, authentication secrets, raw provider payloads or arbitrary JSON
are serialized. Catalog prices and extra source-row fields are excluded.
This allowlist is **not a free-text PII detector**: readers must supply approved,
PII-free descriptive fields. All external text remains untrusted data; Slice 4
must preserve that boundary when formatting prompts, not treat descriptions as
system instructions. No prompts are implemented here.

History accepts `not_requested`, `unavailable`, or an explicit tenant-scoped
`cold_start` attestation with checkedAt after a successful no-approved-memory
check. Stale checks become unavailable. `memories` is always [] in this slice;
extra injected memories are discarded, never merged over facts. No retrieval
has been performed merely because a context is built. Future approved private
memory retrieval requires its own implementation/contract extension.

## Canonical hash

SHA-256 of recursively key-sorted JSON over validated/projected substantive data:
schemaVersion, business/product/preorder facts (including IDs and derived intake
eligibility), effective offer/campaign reference and dates, available analytics or
unavailability state, scenario inputs/results, history status, fixed constraints,
and relevant C1/C6/C8 source versions. Substantive datetime fields are normalized
to UTC ISO milliseconds (the same Date resolution used for eligibility checks).
Arrays retain their semantic order.
Metadata keeps versions separately too; version changes intentionally invalidate
the hash per PRD even when visible numeric values happen to be unchanged.

Excluded: request calculatedAt, source calculatedAt, history checkedAt, provenance,
max-age policy, analytics requirement policy, catalog price, and stripped fields.
Provenance stays in metadata and must be authorized/checked independently; identical
fixture and server facts can share a hash. A catalog edit that bumps productVersion
still changes the hash through that version. Freshness checks run on every build.

Timestamp-only changes preserve the hash while availability/eligibility states
remain equivalent. Crossing an intake deadline changes eligibility and the hash;
an expired active offer or over-age required source fails instead of returning
the old context. The hash is not a time-to-live or an optimistic-lock token.

## Verification

`npm run test:unit` includes `tests/unit/ai-context.test.ts` and retains all pricing
and simulator tests. Synthetic fixtures model target40/paid30/held2/orderable8,
frozen120k vs catalog130k, current10%=108k, hypothetical5%=114k, and unknown actual
costs. Pure tests require no environment secrets, network, database, or provider.

Migration audit: the two existing migrations define 19 legacy tables, including
knowledge_documents/knowledge_chunks. Target v2.1 documents 26 tables and private
campaign_memories, preorders/preorder_items, source versions, and revised capacity
semantics. The old plan still contains legacy/global-knowledge assumptions;
current PRD, task ownership, and this slice's explicit scope take priority.
No query, migration, schema edit, or claim about remote database state was made.
