# Slice 7 — verified database boundaries

**Update, Slice 7B (4 November 2026):** The separately authorized additive migrations now implement source/latest-evaluation CAS, coordinated cost/task/content/blueprint writers, atomic **development-synthetic** completion, completed-state seals and synthetic-memory approval exclusion. See [Slice 7B handoff](../../src/features/campaign-evaluation/SLICE_7B.md). Verified production C6 revision/operational authority and a post-completion correction lifecycle remain unavailable. The following is the original Slice 7 audit, retained as historical rationale rather than the current capability inventory.

Read against both active migrations and the actual local function inventory on 4 November 2026. This document changes no SQL or database object.

`record_campaign_evaluation` is service-only, owner checked, append-only and idempotent by evaluation UUID + exact payload. It locks campaign context, then inserts a complete snapshot in one transaction. For `final` it checks closed/completed state, confirmed costs, published blueprint and relevant order/ledger resolution. It **does not transition a campaign to completed**, accept expected source versions, compare a previous evaluation ID, persist a mutable review state or freeze execution/cost writers.

Existing service-role INSERT/UPDATE grants and the `cost_changed` trigger support independent cost append, version-checked void and a campaign-version-checked completeness review. The trigger invalidates review and advances campaign version after every cost insertion/change. Evaluation review can be an explicitly owner-reviewed **new immutable snapshot**, never an UPDATE of an old evaluation.

Supported application scope without schema changes:

- Record/review promotion costs, preserving zero vs unreviewed/unknown and void history.
- Generate and persist independent provisional evaluation snapshots, including explicit synthetic provenance and AI failure metadata.
- Preflight expected campaign version/context hash and revalidate source before persistence; expose a saved historical snapshot as stale if a source changes concurrently.
- Append an owner-reviewed snapshot referring to its parent. These are independent history entries, not a linear revision sequence with database CAS.
- Exclude every synthetic/provisional snapshot from production Business Memory eligibility.

Blocked capabilities:

1. Atomic closed→completed based on an exact persisted reviewed evaluation and fresh authoritative C6 snapshot. Separate RPC insert + campaign PATCH is not an acceptable replacement.
2. Database-enforced expected source/evaluation revision CAS. A preflight read is not a transaction-level guarantee; this limitation must remain visible.
3. Finalization coordinated with task and cost writes. Existing task PATCH does not lock the parent campaign; existing cost trigger invalidates completeness but does not reject a write after completion. A new finalization RPC alone would not fix those races.

A separately authorized database task would need an evaluated atomic save/finalize command with exact source/parent checks, plus coordinated task/cost write guards or transactional command replacements. It must verify operational completion, cost review and an authoritative C6 contract, preserve append-only evaluations, and never create/approve memory. Synthetic finalization would need an explicit reviewed development contract; the current database has no such contract.

AGENTS.md §4 forbids adding/changing these RPCs/triggers/grants in this task without separate explicit authorization. Slice 7 therefore keeps finalization fail-closed, stores development evaluations as provisional and does not mark any campaign completed.
