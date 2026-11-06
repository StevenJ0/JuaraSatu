# Stage 4B — persistent discussion development

Status: working local flow with real Supabase Auth/PostgreSQL and explicitly synthetic context/Fake Gemini. No schema/migration/RLS changes, dependencies, remote operations, or Slice 5 implementation.

## Start and sign in

1. Use the activated root v2.1 project, ID `campaign-lab`, API `http://127.0.0.1:54321`, DB port 54322. Start it with `npx.cmd supabase start` if needed. Do not reset an existing database to prepare this feature.
2. Use the cutover's two synthetic GoTrue owners and seed dataset. On an already migrated fresh local DB, `node scripts/test-supabase-v21.mjs --setup-fixtures --write-types` provisions the documented fixture accounts and seed. This is a development setup command, not application authentication. It refuses unknown accounts at those IDs. See `database/v2.1/LOCAL_VERIFICATION.md` for prerequisites and data safety.
3. Set `.env.local` (never commit credentials):

```dotenv
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<local-publishable-key>
SUPABASE_SERVICE_ROLE_KEY=<local-server-only-service-role-key>
CAMPAIGN_DISCUSSION_PROVIDER=fake
CAMPAIGN_DISCUSSION_CONTEXT=seeded
```

4. Run `npm.cmd run dev -- --port 3100`, open **http://localhost:3100/dev/discussion**, then sign in with a synthetic owner. Fixture credentials are available locally in the ignored `node_modules/.cache/database-v21-cutover/fixture-credentials.json`; do not copy them into source or logs.
5. Select an owned preorder, create a discussion, send a message, then refresh or open the same `?sessionId=` URL. The browser stores no token in localStorage; GoTrue access/refresh tokens use HttpOnly, SameSite Strict development cookies. The server verifies identity through `/auth/v1/user` and reads membership using the owner JWT on every API request. Refresh uses GoTrue's refresh-token endpoint when needed.

The standalone `fetch` transport uses existing Supabase Auth/PostgREST rather than adding an SDK or an alternative account system. Rafi can later replace the small development cookie surface with the shared application auth helper.

## What is real and what is synthetic

| Boundary | Implementation |
|---|---|
| Authentication | Real GoTrue login, JWT verification, owner membership and preorder/session access |
| Persistence | Real `campaign_ai_sessions`, immutable `campaign_ai_messages`, `ai_generations` through existing atomic RPCs |
| Context | Development-only C1/C8 projection for the authorized seed businesses; C6 explicitly unavailable, history/RAG not requested |
| Provider | Deterministic Fake Gemini using the same prompt, Zod, business guards, Simulator and C2 pipeline |

The context loader is deliberately narrow: only the two documented `is_demo` businesses, published preorder target/quota/capacity 40, no preorder orders, no held/allocated reservation on the seed capacity, and no published campaign. It reads frozen base price and source versions, and rejects unsupported state. It is not Rafi's production availability reader or Indro's offer resolver. Expired seed dates stop generation; do not hide that condition or silently extend published windows. Provision a suitable new development dataset through the owning module when the seed expires.

No KPI, paid Midtrans transaction, production ledger, approval, campaign publication, or memory source is fabricated.

## Simulated interactions

- **A / normal:** normal-price reminder, default assumed four additional units and promotion spend 10000 rupiah when no numeric override/history exists.
- **B / discount:** eligible discount, default ten percent and six assumed units; default spend 25000 rupiah. Unknown cost or other financial blockers still reject the option in the normal domain pipeline.
- **C / revision:** exact text patterns `diskon 5%`, `unit 8`, `biaya 20000` or `budget 20000`. Latest matching values from bounded user history/current message are reused. `pengingat`/`harga normal` preserve a normal-price revision unless a later discount instruction appears. Prefer digits without thousands separators. Defaults/assumptions are capped to the current development fixture slots and owner budget; they are not demand forecasts.
- **D / failure:** controlled `PROVIDER_TIMEOUT`, persisted as failed generation without an assistant success.
- **E / invalid:** malformed provider JSON, rejected as `INVALID_RESPONSE`, with the same failure persistence path.

Fake behavior does not model natural-language intelligence. The React component contains no hardcoded provider response. Fake construction requires both explicit flags and NODE_ENV development/test; it throws in production. Page and API routes additionally return 404 outside development, even when fake flags remain configured. No real Gemini calls are made by this flow.

## API and repository mapping

All endpoints are development-only. Responses contain no credentials and use no-store caching. Cookie-authenticated writes require matching Origin; Bearer-authenticated integration requests may omit Origin.

| HTTP | Purpose |
|---|---|
| POST/GET/DELETE `/api/dev/discussions/auth` | GoTrue login, identity check, clear development session cookies |
| GET `/api/dev/discussions` | Owned preorders and latest 100 active sessions |
| GET `/api/dev/discussions?sessionId=<uuid>` | Consistent version-checked history window, generations, current context hash |
| POST `{action:"create",preorderId,sessionId?}` | Authorized context + idempotent create session RPC |
| POST `{action:"send",sessionId,requestKey,expectedVersion,expectedContextHash,message,preferences,scenario}` | Persistent turn orchestration |
| POST `{action:"refresh",sessionId,expectedVersion}` | Explicit context refresh via CAS; denied while generation is running |
| POST `{action:"recover",sessionId,generationId,expectedVersion}` | Explicitly fail an owned interrupted running generation after two minutes |

| Repository capability | Database operation |
|---|---|
| create | `create_ai_session` |
| view/load | Owner-JWT SELECT sessions/messages/generations; messages ordered by sequence; before/after session version check with one read retry |
| beginTurn | `claim_ai_generation` atomically claims dedupe key, appends user message and advances version |
| completeTurn | `finalize_ai_generation` through service role after user-JWT scope verification; validates proposal/result and reloads session |
| failTurn | `fail_ai_generation` with sanitized error enum and CAS; never appends a false assistant response |
| refresh | `refresh_ai_session_context` |

`DiscussionRepository`'s existing required methods remain compatible with fake tests. The real adapter adds create/view/refresh. `StrategyProposal.persistence` now permits `saved` in addition to the existing `not_saved`; Stage 4A still produces not_saved. Stage 4B marks its server-validated snapshot saved, and exposes it only after database finalization succeeds. The persisted outcome also carries `persisted:true`; chat never approves/publishes anything.

## Request lifecycle, limits and recovery

Authenticated request → membership + owned preorder/session → runtime input validation → load bounded history → atomic claim → completed replay / running response / generation → authorized development context → existing strategy engine → context reload/revalidation + deterministic C2 → validated proposal → atomic finalization → persisted response.

- Idempotency key is scoped by DB to business + generation type, not merely session. The server hash binds session, context, message, preferences and scenario. Version is excluded so the identical original payload can replay after version advancement. A different payload with the same key returns 409. The UI retains its last request for explicit uncertain-outcome retry.
- `expectedVersion` is the version before claim. Claim advances it; generated proposal version is the claim version; finalize advances it again. Competing requests use DB locks/CAS, not process-local locks.
- Request body maximum 16 KiB; owner message maximum 4000 characters; provider history latest 20 contiguous messages and maximum 12000 combined characters. UI loads latest 200 messages/generations and labels truncation; full history stays in PostgreSQL. Persistent summaries/pagination are not implemented.
- Service role is constructed only after JWT ownership checks; the repository rechecks visibility before privileged finalization/failure. HTTP mapping: invalid input 400; unauthenticated 401; forbidden 403; inaccessible session 404; known domain conflict 409; invalid provider 502; persistence/source unavailable 503; timeout 504.
- Only exact known domain messages on SQLSTATE 40001 map to 409. A real `could not serialize access...` transaction abort retries once inside the RPC transport. Unknown 40001 messages and uncertain transport failures are not blindly retried or mislabeled as domain conflicts.
- Provider/validation failure commits a failed generation while retaining the user message. Finalization failure never returns success. If commit outcome is uncertain, an identical request replays the DB state; it may still be running, not falsely complete.
- If the process dies after claim, the UI shows running and polls. After two minutes the owner can explicitly recover using the current version; the existing failure RPC releases the turn. The deadline is enforced on the server, not trusted from browser time. This is not an automatic durable recovery worker. Long-running real-provider integration must revisit the recovery budget before enabling that provider.

The timeout wrapper limits Supabase requests to 12 seconds. There is no new production rate limiter or distributed generation worker in this development-only route; both require review before production rollout.

Context is revalidated before finalization and compared again when loading the UI. The existing finalization RPC binds the session hash but does not lock C1/C6/C8 business facts throughout generation. A later fact change can therefore make a stored snapshot stale; it does not make an operational offer authoritative. Fresh authorized readers and revalidation remain mandatory before any later operational decision.

## Verification and reproducible tests

With local Supabase and development server running:

```powershell
npm.cmd run test:unit
npx.cmd vitest run tests/integration
node tests/integration/discussion-api.mjs
node tests/browser/persistent-discussion.mjs
node tests/integration/discussion-production.mjs
npm.cmd run lint
npx.cmd tsc --noEmit
npm.cmd run build
```

Browser automation reuses installed Chrome through CDP, with no added dependency. Set CHROME_PATH if needed; use DISCUSSION_BASE_URL=http://localhost:3100 to match the Next dev origin. Screenshots at desktop/mobile widths are stored in ignored `node_modules/.cache/campaign-discussion/` and inspected visually. The detector reported no findings.

| Scenario | Verified result |
|---|---|
| A normal / B refresh | Actual service/repository and Chrome reload retain PostgreSQL messages/proposals |
| C duplicate / D conflicting duplicate | One assistant/provider call for replay; altered payload gets domain conflict |
| E concurrency | Two actual Supabase-backed service requests yield one success and one expected-version conflict |
| F provider failure | Controlled failure and invalid response persist only user/failure state; new request can proceed |
| G finalization failure | Actual PostgreSQL denies an incorrectly privileged finalizer; service returns persistence failure, not success |
| H tenant isolation | GoTrue JWT B cannot load/finalize A; privileged transport is not constructed for denied access |
| I stale context | Unit/integration post-generation source change is rejected; HTTP test changes the known demo catalog price, gets STALE_CONTEXT, refreshes explicitly and still calculates from frozen preorder price; catalog value restored afterward |
| J multi-turn | Discount, quantity and budget revisions persist ordered messages; history window/character bounds preserved |
| K replay | Completed request bypasses provider; UI displays replay confirmation without another message |
| L recovery | Running claim is honest; live recovery denied; only an explicitly aged synthetic fixture is recovered by the real HTTP endpoint, then a fresh request succeeds |

Current passing counts: 262 unit tests (247 existing + 15 new), 9 Vitest integration tests (8 new + existing proposal test), 4 real Next HTTP groups, and 8 headless Chrome groups. Lint/typecheck/build pass. Production server checks return 404 for page, API GET/POST and auth POST despite fake flags. No real Gemini, payment or email-provider success is claimed.

## Changed files and handoff

- `src/lib/supabase/transport.server.ts`: typed RPC names/arguments, owner-JWT reads, secret-bearing server transport and bounded serialization retry.
- `discussion-auth.server.ts`, `discussion-api.server.ts`: development Auth boundary, ownership, input/error mapping and orchestration entry points.
- `supabase-discussion-repository.server.ts`, `persistent-discussion-service.ts`: real persistence and pure orchestration.
- `persistence-contracts.ts`, `development-provider.ts`, `development-context.server.ts`: transport runtime validation and isolated synthetic execution path.
- `components/discussion-workspace.tsx`, `components/discussion.css`, `src/app/dev/discussion/page.tsx`: minimal responsive discussion UI.
- `src/app/api/dev/discussions/route.ts`, `auth/route.ts`: thin HTTP routing.
- `contracts.ts`: only the necessary persistence enum extension; C1/C2/C6/C8 contracts remain unchanged.
- `tests/unit/persistent-discussion.test.ts`, `tests/integration/persistent-discussion.test.ts`, `tests/integration/discussion-api.mjs`, `tests/integration/discussion-production.mjs`, `tests/browser/persistent-discussion.mjs`: new verification without weakening existing tests.
- This document and the feature README; `.env.local` enables fake/seeded explicitly, `.env.example` lists safe opt-in placeholders. No package/lockfile or database contract changes.

Rafi: replace the development cookie surface with shared auth and supply the real authorized C1 producer. Indro: supply C6 consistent analytics and C8 effective-offer reader; neither is recreated here. Steven: keep the real repository/RPC orchestration, replace only the injected context/provider when production dependencies are approved.

To use real Gemini later, inject the existing `createGeminiStrategyProvider` and real C1/C6/C8 readers into the same service; validate provider availability and structured outputs first. Merely changing the fake flag to gemini does not enable production: the development route deliberately fails closed. No Gemini model or adapter was changed by Stage 4B.

Stage 4B is ready for local end-to-end review. Production remains blocked on shared auth, authoritative producers, provider verification and operational controls. Review this slice before authorizing a separate Slice 5 task; no blueprint/approval, publishing, checkout or RAG implementation is included.
