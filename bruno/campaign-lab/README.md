# Campaign Lab — Bruno local API collection

Native `.bru`, verified against installed Bruno Desktop **4.3.0**, bundled `@usebruno/lang` **0.40.0**. No CLI/dependency was installed. All application routes here are **development-only**, not production endpoints.

For natural Indonesian questions with **Real Gemini**, use [the separate manual guide](../../docs/qa/BRUNO_REAL_GEMINI.md) and folder `10-Real-Gemini` (two explicit paid opt-in requests). The quick start below is the Fake regression workflow. Use the currently assigned Owner A account, including a personal account selected during data recovery; the old official fixture A may no longer have membership.

## Quick start

1. Keep local Supabase running and start `npm.cmd run dev -- --port 3100` if port3100 has no server. Do not reset the database or start a second devserver on the same cache.
2. In Bruno Desktop, **Open Collection** → select this directory containing `bruno.json`. Choose environment **local**.
3. In the environment **Secret Variables** tab, privately set `ownerEmail` and `ownerPassword` to the existing synthetic owner A. For security tests also set `ownerBEmail` and `ownerBPassword`. No credential is in this repository collection. Do not save response tokens/cookies as examples or export request history containing credentials.
4. Set `allowAuth=true`, then send `00-Setup-Auth/01-Login-owner-A`. Expect200 `{success:true}`. Enable Bruno's cookie handling; the app returns HttpOnly cookies, not access tokens in JSON. Send `02-Check-cookie-session`; expect200 `{authenticated:true}`.
5. Read [the full guide](../../docs/qa/BRUNO_API_TESTING_GUIDE.md) before enabling workflow mutations. Set `confirmFakeProviders=true` **only after verifying the documented server flags are Fake/synthetic**. `allowMutations`, `allowNegative`, and `allowLifecycle` default false and must be deliberately enabled for the controlled workflow.
6. Prepare/reuse a future-valid isolated fixture with `node scripts/prepare-campaign-execution.mjs --discussion`; set nonsecret `preorderId` from its ignored `node_modules/.cache/campaign-discussion/preorders.json` owner-A entry. Do not auto-select an expired published preorder from the list.
7. Execute folders `03` → `04` → `05` → `06` → `07` in numeric order, excluding `[BLOCKED] Recover-interrupted-generation`. Folder `08` intentionally logs out, switches owners and expects errors; run it after the workflow. Folder `09` is a separate optional bearer alternative, disabled by `allowDirectAuth=false`.

**Do not Run All blindly.** Defaults intentionally block writes/auth changes before HTTP; they are not intended to produce an all-green collection run. Explicit lifecycle opt-in allows publication/closing/completion; completed campaigns cannot ordinarily be reopened or edited. A fresh workflow appends a new isolated campaign; it never deletes old data.

## Layout and coverage

```text
bruno.json, collection.bru, environments/local.bru
00-Setup-Auth/                 cookie login, session, preorder list
01-Pricing-Simulator/          README: NOT EXPOSED VIA HTTP
02-AI-Context/                 README: internal / indirect coverage
03-AI-Strategist/              persistent turns, replay, failures, refresh, conditional recovery
04-Blueprint/                 persisted selection, revisions/caption, approval
05-Publishing-Execution/       publish, C3/calendar/task/content, close/replay
06-Evaluation/                 costs/correction, KPI scenarios, CAS, review, simulated finalization
07-Business-Memory/            handoff, candidate/review/reject, forbidden approval, idle worker, cold-start
08-Negative-Security/          auth/validation/CSRF/tenant/version/source/lifecycle failures
09-Optional-Bearer/            local Supabase token + owner-only PostgREST read
BLOCKED.md
```

139 actual HTTP request files cover all13 application method/path combinations plus three optional direct/bearer requests. Runtime scripts capture the actual `sessionId`, `generationId`, `proposalVersion`, `proposalKey`, campaign/blueprint/evaluation/memory IDs, hashes and versions using `bru.setVar`. No `proposalId`/`alternativeId` fields exist in these APIs. No service-role RPC is exposed here.

Native syntax: `node scripts/validate-bruno-collection.mjs` from repository root, using the installed Desktop parser headlessly. Set `BRUNO_EXECUTABLE` / `BRUNO_LANG_PATH` if installed elsewhere; unavailable parser is an explicit failure, never an automatic install.

Optional compatibility harness (not Bruno CLI): `node scripts/smoke-bruno-collection.mjs --read-only` authenticates and inspects without business mutations; `--allow-local-mutations` explicitly appends the synthetic workflow after verifying local/Fake flags. It reads existing private fixture credentials in memory and saves no tokens/passwords. See the guide for execution evidence and limitations.

## Limits

Fake strategy/evaluation/memory and synthetic KPI do not prove real Gemini or business performance. Synthetic memory approval **must return409**; its job is absent, worker is idle and retrieval is cold-start. Verified approved-memory E2E and real embedding remain blocked. Read [BLOCKED.md](BLOCKED.md) and the [complete request inventory](../../docs/qa/BRUNO_REQUEST_INVENTORY.md).
