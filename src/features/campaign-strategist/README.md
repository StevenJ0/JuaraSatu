# Gemini Strategist & Discussion — Slice 4

Stage 4A contains a strategy service, structured prompt, server-only Gemini adapter,
runtime/domain validation, deterministic recalculation, and explicit revalidation.
Stage 4B now has real local Supabase persistence, GoTrue authentication, atomic
discussion RPC integration and a development-only Fake Gemini UI. See
[STAGE_4B.md](./STAGE_4B.md) for setup, exact scope, tests and production gaps.
There is no production discussion route, approval or publishing UI.

## Public contracts and flow

Import from `@/features/campaign-strategist`:

- `generateCampaignStrategies(input: unknown, dependencies: StrategyDependencies): Promise<StrategyResult>`.
- `revalidateStrategyProposal(proposal: unknown, contextInput: unknown, now: string): StrategyResult`.
- `DiscussionInputSchema`, `DiscussionMessageSchema`, `GeminiReplySchema`,
  `StrategyAlternativeSchema`, `StrategyProposalSchema`, `StrategyChannelSchema`,
  `StrategySourceSchema` and their corresponding public inferred types.
- `StrategyProvider`, `StrategyProviderResult`, `StrategyDependencies`,
  `StrategyPrompt`, `StrategyResult`, and discussion repository types.

The secret-bearing factory is a separate server import:
`@/features/campaign-strategist/gemini.server` exports
`createGeminiStrategyProvider(config: unknown): StrategyProvider`.
Its `server-only` import prevents Client Component imports; this is the only new
dependency. Node tests mock that marker; production imports keep the marker intact.

Flow: validate discussion -> authorized context loader -> Slice 3 builder using a
trusted current clock -> expected-context-hash check -> prompt -> provider -> JSON
envelope validation -> fresh context read/hash check -> per-option Zod/domain guards
-> existing Simulator/C2 -> proposed, explicitly unsaved result.
Producer failure/staleness has no fixture fallback. Provider calls do not run in DB
transactions. A changed/unavailable context after generation discards the response.

The future handler must authenticate an owner and bind business/preorder scope;
`loadContext` must load authorized C1/C6/C8 snapshots in BuildBusinessContextInput
shape. No browser-provided facts are authoritative. The service passes only IDs
to that loader, not chat text. Reader implementations/auth are not supplied here.

## Discussion and proposals

Input: businessId, preorderId, nullable sessionId, requestKey, expectedVersion,
expectedContextHash, message, server-loaded history, preferences.
Preferences: nullable budgetCapIdr, allowDiscount, whatsapp/instagram channel list.
Message <=4,000 characters; <=20 ordered historical messages and <=12,000 combined
history/new-message characters. History roles are only user/assistant, never system.
Consecutive user messages after a failed generation are allowed. The caller loads
an explicit bounded history window; this service does not silently truncate it.
Older context hashes remain labelled historical, not reinterpreted as current facts.
Prompt cap is 40,000 characters; response cap is 64,000 characters.

Gemini must return schemaVersion=1, contextHash, reply, sourceReferences, options,
limitations. An option contains proposalKey/title, marketingApproach, shared C2 offer,
assumedAdditionalUnits, assumedPromotionCostIdr, channels, startsAt/endsAt, hypothesis,
assumptions, risks and sourceReferences. Computed prices/totals, operational status,
approval flags, tools, URLs, and arbitrary memory references are not accepted fields.

Generated metadata: contextHash, requestKey, candidate proposalVersion=expectedVersion+1,
generatedAt, configured model, providerRequestId, preferences, state=proposed,
persistence=not_saved, requiresOwnerReview=true. This is not a committed session
version or proof of request idempotency. `status=alternatives_available` means at
least one validated alternative; `status=no_valid_options` means none survived this
response, not that every mathematically possible strategy was explored.

Per-option guards enforce supported offers/approaches/channels, owner budget,
positive assumed goal units <=orderable, valid dates inside preorder/cutoff with
an unexpired end, source availability and unique keys/channels. Limited discount
uses percent_discount; reminder/value_content use normal_price (promotion spending
may still be positive). Existing Simulator/C2 rejects financial-policy/capacity
violations. Unknown cost remains null; normal-price planning can retain its warning,
discounts with unknown/nonpositive unit contribution are removed. Estimated-cost
warnings remain visible. Scenario-level nonpositive contribution keeps C2's existing
informational warning semantics. No price/discount formula is duplicated here.

One bad option is removed without contaminating other valid options. Invalid
envelopes, unsafe reply text, fabricated top-level sources and wrong context hashes
fail closed. Closed/not-started/sold-out preorder contexts do not call the model.
An active campaign is shown separately with a one-active-campaign limitation;
alternatives never replace it. Availability is a snapshot, not a reservation.

Explicit revalidation rebuilds fresh context and recomputes stored scenario amounts
using the saved preferences. Changed facts require a fresh generation/review; this
function cannot approve or publish anything. Actual approval/publish must later
repeat auth, freshness, version, and transactional domain checks.

## Prompt and security boundary

Fixed system rules are separate from JSON data. Facts, hypothetical input, owner
preferences, historical status, and untrusted business/chat text have distinct
sections. Historical knowledge currently contains no retrieved memories. Source
allowlist: c1.business, c1.product, c1.preorder, c8.effective_offer, and
c6.preorder_metrics only when actually available.

Common email/phone/credential patterns are redacted from descriptive/chat text.
This is not full PII detection (especially personal names); callers must still
provide AI-approved text and never send raw orders/provider payloads/secrets.
All JSON text is untrusted even in an otherwise authoritative fact section.
No tool calling, scraping, model-initiated reads/writes, approval, or publication.

Prose is qualitative: numerical claims, obvious contacts, common guarantee terms,
simple fabricated memory citations and false approval/publication claims are
rejected. Numbers belong in structured parameters
and deterministic computedScenario. This conservative heuristic can reject harmless
prose and cannot prove all natural-language claims true; model prose still needs
owner review and escaped rendering. Structured guards enforce financial/access
boundaries independently of whether prompt injection is recognized linguistically.

## Gemini adapter verification and failures

Installed @google/genai 2.32.0 supports the Interactions API already used by
`scripts/test-gemini.mjs`. This adapter uses response_format type=text,
mime_type=application/json, and a JSON Schema generated from GeminiReplySchema.
Provider schema is a subset/formatting aid; Zod and business guards remain required.

Config requires apiKey and model; it does not select a replacement model. The smoke
uses GEMINI_MODEL or the existing script default gemini-3.8-flash. Config is never
logged/returned. store=false, tools=[], stream=false, automatic_continuation=false,
max_output_tokens=4,096. No provider-side conversation ID is used as app persistence.

Total timeout defaults to 20 seconds (max30), including one optional retry.
maxAttempts defaults to2 (max2). Each attempt receives the remaining deadline and
an AbortSignal; a Promise.race bounds noncooperative transport. SDK retries are
disabled; only transient connection/timeout/rate-limit/server failures retry once
after a bounded500ms delay. Client/config/auth/model errors do not retry. Abort
does not guarantee provider-side cancellation or absence of usage charges.
Refusal, malformed/incomplete response, timeout, 429, unavailable model and generic
unavailability return sanitized codes, never raw exceptions or fabricated success.

Official references checked with the installed SDK:
[Structured output](https://ai.google.dev/gemini-api/docs/structured-output),
[Interactions/storage](https://ai.google.dev/gemini-api/docs/interactions-overview),
[Retry guidance](https://ai.google.dev/gemini-api/docs/troubleshooting).

## Stage 4B repository handoff — blocked

`DiscussionRepository` declares owner-scoped load, atomic beginTurn, completeTurn,
and failTurn. An auth service must supply trusted ownerUserId; an ID alone is not
authentication. A server-computed canonical inputHash must bind scope, message,
history/versions, contextHash and preferences; never accept that hash as client truth.

beginTurn claims a generation/request key once, appends the user message and advances
session version. Same key/hash replays running/completed/failed state; different hash
conflicts. Another request cannot run while a turn is pending. completeTurn atomically
CASes the claim, appends assistant/proposal provenance, records generation success,
and advances version. failTurn records sanitized failure without fake assistant text.
Failed requests need explicit retry with a new key; ambiguous commits must be read
and replayed, not blindly regenerated. The provider call belongs between DB calls.

The in-memory fake is under tests/fixtures only. It verifies consumer expectations,
not RLS, SQL atomicity, restart survival, or distributed concurrency. No production
repository/session creation/resume endpoint is implemented. All real persistence is
blocked until approved schema/auth/atomic operations exist.

Current migrations have no campaign_ai_sessions/campaign_ai_messages; legacy
ai_generations lacks target session/preorder/request_key lifecycle and dedupe fields.
No approved atomic claim/finalization capability or owner-auth service is present.
Do not emulate this with legacy campaign fields, application Maps, or unauthorized
SQL. Required follow-up is a separate reviewed database/auth task, including session
creation, version/context refresh, UNIQUE dedupe and failure/lease recovery semantics.

## Verification and handoff

`npm run test:unit`: fake engine/provider and repository contract tests, plus all
existing C2/simulator/context tests. Tests need no credentials/network.
Opt-in live smoke: set CAMPAIGN_GEMINI_SMOKE=1, then
`npx vitest run tests/provider/gemini.smoke.test.ts`. It loads configured environment,
uses only synthetic facts, one attempt, store=false, and logs sanitized metadata.
This is separate from default unit tests. Live strategy smoke was attempted and
failed with PROVIDER_UNAVAILABLE; an isolated minimal structured SDK request also
failed with APIConnectionTimeoutError. Unauthenticated endpoint reachability worked;
successful real model/schema generation is not yet verified. No model was switched.

Rafi: authorized C1 business/product/preorder facts + effective availability, source
versions and owner authentication. Indro: C6 aggregate snapshots + C8 current offer
scope/version/window, using the Slice 3 contracts. Production also needs a shared
clock/freshness policy, distributed owner AI rate limits/budget controls, approved
transactional persistence, tenant/concurrency integration tests and a passing live
provider smoke. None is claimed by fixture tests. Slice 5 is not implemented.

### Provider diagnostic follow-up — 2 November 2026

No runtime/model/endpoint/timeout change was justified. The configured model and
installed SDK remain unchanged. Request configuration is POST
`https://generativelanguage.googleapis.com/v1beta/interactions`, JSON structured
output, store=false, tools=[], SDK retries disabled, bounded adapter retry/deadline.
Diagnosis used four bounded generation attempts (SDK/REST structured, SDK plain,
full strategy), each with one attempt. Other requests were read-only metadata,
connectivity, or a synthetic nonexistent interaction lookup.

| Check | Observed result | What it establishes |
|---|---|---|
| Environment presence | Key/model set; expected model matches; no proxy/custom-base/Vertex overrides; TLS verification enabled | Missing variables or silent endpoint override were not observed. Values were not printed. |
| System DNS | Both IPv4/IPv6 answers, one lookup ~11.1s; explicit A-record lookup ~36ms | Resolution works but intermittent startup latency is a possible timeout contributor, not a proven explanation for every failed request. |
| TLS | Authorized TLS1.3 over IPv6, ~132ms | Certificate verification and at least one network path work; no reason to disable TLS or IPv6. |
| Firewall profiles | Domain/private/public profiles enabled | Profiles were read without changes; effective per-rule egress filtering is not established by this check. |
| HTTPS root | HTTP404, ~189ms | Expected unauthenticated route response, not a connectivity failure. |
| Configured model metadata | HTTP200, ~210ms | Key accepted for metadata and model listed; does not prove inference billing/tier/permission/quota eligibility. |
| SDK minimal structured output | HTTP503 in ~3.3s, InternalServerError | Request reached the existing Interactions endpoint. |
| Equivalent REST structured output | HTTP503 in ~2.6s, service_unavailable | Failure also occurs without the SDK and without the strategy schema. |
| SDK plain text | APIConnectionTimeoutError at ~12s | Failure is not restricted to structured output. |
| Full strategy smoke | PROVIDER_UNAVAILABLE; fetch TypeError at ~10.5s, no HTTP response | Transport failed before the application 30s deadline and before any model JSON could be validated. Exact lower-level cause was not captured in that attempt. |
| SDK read-only nonexistent interaction | HTTP400 in ~253ms | SDK can receive HTTP responses; synthetic invalid ID was intentionally not an inference test. |

Confirmed: external 503 responses and intermittent transport/latency failures on
this project's current API path. Not confirmed: global provider outage, invalid
key, unsupported model, inference entitlement, or a specific firewall/DNS cause
for earlier timeouts. A metadata200 must not be used to infer paid-tier eligibility.
No successful model response exists from this diagnostic run, so real structured
generation, financial recalculation on real output, and full engine behavior remain
unverified; fake tests are separate evidence only.

The smoke now records only elapsed time, HTTP status, error class, and allowlisted
network codes; never request headers/bodies/URLs, secrets or raw exceptions. On a
future success it also verifies C2 unit/order pricing, contribution invariants,
capacity, context binding, owner review and proposed/not_saved state. Assertions
are not weakened to accept empty/invalid/provider-failure output.

Highest-priority follow-up: test inference with the same model/project in AI Studio
to separate project/provider availability from this machine's intermittent transport,
then rerun the one-attempt strategy smoke after the external issue is resolved.
Do not rotate keys, switch models/endpoints, or enlarge timeouts based on timeouts
alone. Official [troubleshooting guidance](https://ai.google.dev/gemini-api/docs/troubleshooting)
also distinguishes metadata access from inference access.
