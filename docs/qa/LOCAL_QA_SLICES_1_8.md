# Campaign Lab — local QA guide, Slices 1–8

Prepared 4 November 2026 (Asia/Jakarta). This is the user's manual test guide; the agent ran automated tests, not the full manual QA. Use local synthetic accounts/data and the current migration chain. Do not reset, change historical deadlines, fabricate payments or copy test fixtures into a remote database.

## Readiness matrix

| Slice | Local behavior | Provenance / limitation |
| --- | --- | --- |
| 1 Pricing C2 | Shared deterministic frozen pricing, discounts and numeric guards | Pure calculations tested; checkout integration belongs to its producer |
| 2 Simulator | Independent scenario quantities/spending, capacity and policy guards | Hypothetical assumptions, not demand predictions |
| 3 Context | Scope/freshness/hash/unknown-cost/current-offer separation; bounded history | C1/C6/C8 production producers not fully integrated; active context is explicitly synthetic |
| 4 Strategist/discussion | Real Auth/RLS/persisted sessions, retries and typed proposals | Fake Gemini active; real text-generation E2E unverified |
| 5 Blueprint | Real sourced SQL creation/revision/explicit approval and materialization | Fake generation, source/financial checks retained |
| 6 Publishing/execution | Real atomic publish, calendar/checklist/copy/close and C3 projection | Synthetic context; no automatic social posting |
| 7/7B Evaluation | Real append-only SQL, source/latest CAS and atomic simulated completion | Fake Evaluation/C6 fixture; verified production completion blocked |
| 8/8B Memory | Real draft/review/rejection, atomic approval/queue/writeback primitives, scoped explicit worker, embedding/retrieval/context contracts | Main verified approval/retrieval blocked by C6/C7 authority; synthetic approval correctly rejected; worker idle; one real embedding smoke failed |

The full application is not production-ready. In particular, a green local suite does not establish live Gemini, verified payments, authoritative C6 or production RAG approval.

## 1. Start local services

From `D:\Project\campaign-lab`, start Docker Desktop, then reuse the existing Supabase local project:

```powershell
npx.cmd supabase start
npm.cmd run dev -- --port 3100
```

Do not run database reset or a linked/remote migration command. Slice 8 adds no migration. The actual stack uses API `http://127.0.0.1:54321`, Studio `http://127.0.0.1:54323`, and the app `http://localhost:3100`.

If starting Next repeatedly shows unsolicited HMR reloads, stop only your devserver and archive its generated `.next/dev` cache before restarting. Preserve source/database data. Do not run a second devserver against the same generated development cache.

## 2. Configuration and accounts

Retain the existing local URL, publishable key and server-only service-role credential. Do not print/paste credentials into tests, screenshots or source. Relevant mode values:

```dotenv
CAMPAIGN_DISCUSSION_PROVIDER=fake
CAMPAIGN_DISCUSSION_CONTEXT=seeded
CAMPAIGN_BLUEPRINT_PROVIDER=fake
CAMPAIGN_BLUEPRINT_APPROVAL=synthetic
CAMPAIGN_EXECUTION_MODE=synthetic
CAMPAIGN_EVALUATION_MODE=synthetic
CAMPAIGN_MEMORY_PROVIDER=fake
CAMPAIGN_MEMORY_RETRIEVAL=fake
```

Real embedding additionally requires `GEMINI_API_KEY` and the explicitly intended `GEMINI_EMBEDDING_MODEL`; no model is guessed. The Gemini **text** model configuration is preserved. Fake Memory/embedding modes are rejected outside development/test; these UI/API routes return 404 in production.

Slice 8B explicitly configures `GEMINI_EMBEDDING_MODEL=gemini-embedding-2`. The active retrieval/worker mode remains `fake` for deterministic local verification. One separately authorized real request failed with `EMBEDDING_UNAVAILABLE`; a passing Fake suite does not replace real-provider evidence. Two additive local migrations (`20261104093000`, `20261104094000`) are applied; other local checkouts can apply this reviewed chain with `npx.cmd supabase migration up --local`, never reset/linked/push.

Use the two existing synthetic GoTrue accounts prepared during the v2.1 cutover. The ignored local file `node_modules/.cache/database-v21-cutover/fixture-credentials.json` holds their login details for local use only; do not publish it. Owner A's business starts `aaaaaaaa…`, owner B's starts `bbbbbbbb…`. No real customer account or verified payment is required for this simulated workflow.

## 3. Prepare safe, future-valid fixtures

With the server running:

```powershell
node scripts/prepare-campaign-execution.mjs --discussion
node scripts/prepare-campaign-execution.mjs
node scripts/prepare-campaign-execution.mjs --evaluation
node scripts/prepare-campaign-execution.mjs --memory
node scripts/prepare-business-memory.mjs
```

The commands reuse valid isolated records or append new ones. They do not extend old preorder dates, reset tables or create orders/payments. Separate discussion/execution/evaluation/memory preorder namespaces prevent test publication races. The final command prints an exact memory URL and saves the source IDs/hash to ignored `node_modules/.cache/business-memory/scenario.json`.

Prepared current Slice 8B source: `http://localhost:3100/dev/memories?campaignId=c0e1a245-be84-45a8-aa96-ce7b0f18b136`. It is completed/synthetic with no candidate yet, ready for the failure/valid/review steps below. Re-run preparation if later source revisions make it stale. A separate [captured Slice 8 browser candidate](../examples/slice-8-memory-candidate.json) is dated evidence of stored draft/review fields; it is not a current eligible or approved source.

It prepares a completed **synthetic fixture through the real existing workflow**, not a production-approved memory. To test the full manual owner flow instead, start with a new discussion on one of the current synthetic preorders and perform the following steps yourself.

## 4. Routes and owner flow

| Route | Purpose |
| --- | --- |
| `http://localhost:3100/dev/discussion` | Login, current preorder context, persisted Fake strategy and blueprint |
| `http://localhost:3100/dev/campaign-simulator` | Hypothetical independent promotion comparisons |
| `http://localhost:3100/dev/campaigns` | Publish approved campaign, execution/checklist/content and close |
| `http://localhost:3100/dev/evaluations` | Closed campaign KPI/costs, evaluation/review and simulated completion |
| `http://localhost:3100/dev/memories` | Completed sources, candidate generation/review/rejection and eligibility/retrieval state |

1. Login as owner A. Select a future-valid preorder, not an expired historical one.
2. Open a new AI discussion. Observe Fake/synthetic labels and current memory cold-start/unavailable message.
3. Generate alternatives. Inspect hypothetical quantity/spending and deterministic frozen pricing.
4. Open Simulator and compare normal/no-promotion versus discounted scenarios with independent assumptions. Excess capacity or unknown discount costs must block inappropriate output.
5. Return to discussion, revise parameters, then choose a **persisted** proposal.
6. Create a campaign draft and Fake-generated blueprint. Inspect goal, offer, dates, KPI, budget, calendar and caption before approval.
7. Revise if desired. Explicitly approve the exact current blueprint/version.
8. Open execution and explicitly publish. Inspect actual persisted publication baseline and C3 offer state.
9. Review calendar, complete/reopen checklist tasks, copy a caption and refresh. Copying is not evidence of social posting.
10. Explicitly close the campaign. Its history/tasks remain available; the offer is ineligible.
11. Open evaluation. Keep hypothetical plan, observed synthetic C6, attribution, reviewed spending and checklist distinct.
12. Record an owner-reported synthetic promotion expense or explicitly confirm complete zero spending. Budget alone is not actual spending.
13. Generate and persist Fake Evaluation. Try failure/invalid cases on a separate test source; facts are not replaced with a false successful narrative.
14. Explicitly review the latest current evaluation.
15. Separately confirm **Finalisasi simulasi lokal**. Refresh: completed timestamp and final audited snapshot persist. Cost/task writes must be rejected afterward.
16. Follow **Tinjau dan buat candidate Business Memory** from the completed evaluation.
17. Before saving the first candidate, try provider failure/invalid/missing-evidence. Expect an error and no candidate row. Select valid and generate a draft.
18. Inspect objective/strategy/results/lessons and source links. Numbers come from the evaluation, interpretation cannot supply financial fields. Refresh must retain the draft.
19. Confirm owner review and save it, or mark the draft not used. Review/rejection remains **draft**. Approval is disabled and the API/SQL reject synthetic approval. There is no fake approval fallback.
20. Observe the draft has no approved eligible source/job. Its queued column is not proof of enqueue. Select **Jalankan worker memory**: expect **Worker idle**, zero claimed, no provider call. Refresh retains the draft. Where a legitimately eligible source later exists, explicit approval must atomically enqueue; the worker can then display the persisted job/attempt/error and atomic success. Do not manually PATCH approved/ready states.
21. Search historical memory. Synthetic drafts yield **cold_start**, not a successful retrieval. Unavailable is shown separately when retrieval/configuration/source attestation fails. Eligible sources with no matching results use **no_match**.
22. Start another discussion on the current preorder. Its cold-start label is honest; current facts and existing C2/Simulator rules still drive the Fake strategy. Main-stack positive verified-memory grounding remains blocked; the bounded/source-reference integration is covered by typed fixtures and separate SQL plumbing tests.

Steps 19–22 deliberately do not claim production approval/indexing/retrieval success. Required follow-up capability decisions are in [the database gap contract](../plans/slice-8-database-gaps.md).

## 5. Indexing and real-provider diagnostics

```powershell
node scripts/run-memory-indexing.mjs
node scripts/test-memory-embedding.mjs
```

The first now uses `claim_memory_jobs` with owner/business and model/profile/version scope, one job per invocation, sixty-second lease and five attempts. For current synthetic drafts it returns `{status:"idle",claimed:0,...}` with exit zero. Idle is not indexing success. It never calls the global claimant or claims unrelated jobs. A legitimate future approved job uses `complete_memory_index_job` for vector+ack or safe retry/dead failure in one transaction. A stale/expired attempt cannot commit; it can be reclaimed after expiry. No scheduler is enabled.

The embedding diagnostic sends **one potentially billable** bounded non-sensitive real request when the intended model and credential are configured. Run it only when you intend that real request. It never falls back to Fake or changes the text model. The agent's single authorized attempt failed with `EMBEDDING_UNAVAILABLE` after about 10.6 seconds, with no real vector or known HTTP status; it was not retried. On a future successful authorized run, the script validates 768 finite nonzero normalized values/profile, then stores/reads the vector in a rolled-back local temporary table. Those checks do not prove semantic relevance or main-stack approval.

For vector/job plumbing run `node scripts/test-database-v21.mjs`. Its labelled disposable PostgreSQL and separate `memory_review` database retain explicit synthetic/test-only fixtures. Original legacy assertions run unchanged on their original five-migration contract; hardened SQL is compiled/audited separately. Positive transition tests invoke private primitives with no application-role grants. The public wrappers still reject those sources. No fake approved memory is inserted into the active application. These are transaction/vector tests, not approved Slice 7B/8 production E2E.

## 6. Failure and isolation checks

- Keep a stale draft page open, change a relevant source through an authorized test operation, then retry review: expect conflict/stale, without deleting the candidate.
- Reuse an exact generation/review request for retry: one canonical candidate/current review. Reuse its ID with conflicting content: conflict.
- Record an incorrect expense before completion, void it with a reason and re-review completeness. After completed, ordinary financial/checklist corrections are unsupported and rejected.
- Login as owner B, paste owner A's evaluation/memory URL and try the same API IDs: expect not found/forbidden, not another business's text.
- Neither chat agreement nor memory generation approves a campaign/memory. Draft and failed/stale/incompatible sources never enter strategy history.
- With embedding configuration unavailable, the UI distinguishes unavailable from cold-start; no synthetic history is fabricated.
- `memory:<UUID>` references must belong to the actual bounded retrieved set. Inspect source campaign/evaluation/version/profile links when an eligible verified path becomes available. Similarity is not proof of future campaign success.

## 7. Automated commands

Run the fixture preparation first. Execute mutating HTTP/browser scripts sequentially, and do not edit source during Chrome runs; HMR can replace form elements while input is being entered.

```powershell
npm.cmd run test:unit
npx.cmd vitest run tests/integration
node scripts/test-database-v21.mjs
node scripts/test-supabase-v21.mjs
node tests/integration/evaluation-finalization.mjs
node tests/integration/discussion-api.mjs
node tests/integration/blueprint-api.mjs
node tests/integration/execution-api.mjs
node tests/integration/evaluation-api.mjs
node tests/integration/memory-api.mjs
node tests/browser/campaign-simulator-comparison.mjs
node tests/browser/persistent-discussion.mjs
node tests/browser/campaign-blueprint.mjs
node tests/browser/campaign-execution.mjs
node tests/browser/campaign-evaluation.mjs
node tests/browser/business-memory.mjs
npm.cmd run lint
npx.cmd tsc --noEmit --pretty false
npm.cmd run build
node tests/integration/discussion-production.mjs
```

Chrome screenshots and examples are in ignored cache directories. Build uses the application's configured Google fonts. The production-route test owns and stops its temporary localhost server. No command in this guide commits, pushes, deploys or resets a database.

Recorded automated results and distinctions between actual SQL, Fake providers, counterfactual typed fixtures and the failed real-provider test are in the [Slice 8B verification record](../../src/features/business-memory/SLICE_8B.md#12-automated-verification). Full manual QA remains for the user after handoff.

Final recorded checks: 432 unit / 43 integration tests, 28 HTTP / 54 Chrome groups, 14 Slice 7B groups with 12 observed lock races, preserved original SQL suites plus ten Slice 8B groups/five observed lock races, 888 catalog matches/zero deviations, 15 production route guards, lint/typecheck/build passed. One real embedding smoke failed; the full production-approved memory workflow was not demonstrated.

## 8. Remaining gates

Authoritative C1/C6/C8 and verified final C7 eligibility; source-authority integration before enabling production approval/retrieval; candidate-text revision/post-completion correction policy; successful real embedding and semantic retrieval evidence; real Gemini strategist/evaluation E2E; full manual QA by the user. Scoped claim and atomic lease-fenced vector+ack are implemented; synthetic approval remains forbidden. Do not add a development approval bypass without separate authorization.
