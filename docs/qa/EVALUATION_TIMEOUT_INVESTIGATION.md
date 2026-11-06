# Evaluation timeout investigation - 5 November 2026

## Verdict and root cause

**Offline investigation/verification PASS. Live timeout resolution and Real Gemini Evaluation E2E remain NOT VERIFIED. Zero Google API calls were made, including model metadata.**

Observed request: 5e4d2dba-3a5b-4538-870e-c4ef72b01dcf. Read-only PostgreSQL confirms provider gemini, model gemini-3.6-flash, analysis status failed, nullable provider ID and no accepted narrative. The row hash before this task was 6dc9dc5c414a265b93c299930ab22a06.

Confirmed from supplied runtime trace:
- Provider/request preparation reached SDK_REQUEST in25 ms and actual dispatcher invocation in44 ms.
- The configured60,000 ms provider deadline expired; transportMs59994, elapsed about60028-60076 ms, httpStatus:null and responseReceived:false.
- Domain validation did not reject a returned narrative: there was no accepted provider response to validate.
- HTTP200 in about61 seconds represents durable failed Evaluation state, not successful inference.
- The30-second connector and60-second provider deadline are different budgets. One cannot infer a specific DNS/TCP/TLS outcome from the latter alone.

The old instrumentation recorded fetch entry/return, not socket assignment, upload completion or first parsed response bytes. Therefore the precise original network phase and underlying cause remain unknown. Provider queuing/inference, stalled network/proxy/firewall, pooled-connection behavior and other remote delays are hypotheses, not proven root causes. No upstream503/capacity response was observed in this failure.

## Actual execution flow and boundaries

1. evaluationPost -> boundary -> authenticateDiscussion: development guard, cookie/bearer authentication via local Supabase HTTP, then owner membership/RLS scope. checkWriteOrigin and ActionSchema validate the command.
2. evaluationService.generate -> repository.evaluation: HTTP/PostgREST lookup for request-ID replay; then context -> repository.facts.
3. evaluationRepository.facts -> executionRepository.load: campaign read; blueprint/preorder/item reads in parallel; tasks/contents in parallel; campaign revision recheck; then costs and campaign metadata. These are HTTP/database waits. The existing bounded read retries concern source consistency, not LLM retries.
4. syntheticCampaignAnalytics, buildEvaluationContext, fingerprint/hash and calculateEvaluation perform synchronous validation/calculation. BigInt finances, source versions, window and provenance remain authoritative.
5. configuredEvaluationProvider builds expected classification literals, allowed-reference schema and serialized summary. No complete business description, customer records, raw orders or history is sent for Evaluation.
6. createGeminiJsonProvider constructs SDK/schema synchronously, then awaits interactions.create. Installed SDK2.32.0 normalizes fetchOptions to fetch_options, preserves the abort signal, and disables SDK retries with strategy none.
7. SDK -> custom httpOptions.fetch -> geminiFetch -> Next patched fetch -> scoped Undici Agent. Connections use30 seconds; provider Promise.race/controller bounds the whole SDK operation, including response-body decoding, at60 seconds.
8. Completed envelope -> JSON.parse -> Zod -> validateEvaluationNarrative. Timeout skips narrative validation and produces failed analysis with truthful provenance.
9. Source is reloaded/revalidated, then repository.save -> campaign read + record_campaign_evaluation_cas RPC. view reloads facts/history/latest, and evaluationHandoff verifies immutable source/financials. Response.json serializes the API response.

The observed60 seconds were inside the provider interval. Authentication/SQL could cause other latency, but cannot explain away this measured transport interval. Supabase has its own12-second per-request timeout; the60-second budget is not a global cap for the entire HTTP route.

## Measured performance findings

| Component | Before | After | Evidence/limit |
| --- | --- | --- | --- |
| Context assembly | Not separately measured in the failed live trace |51.92-67.69 ms | Two authenticated local GETs; no generation. Not evidence of a context speedup. |
| Database reads | No per-read timing in original trace | facts50.23-61.80 ms; history8.87-10.38 ms; latest6.41-7.13 ms | Repository round trips including validation/network, not PostgreSQL CPU timing. facts aggregates multiple queries. |
| Authentication | Not separately measured |27.16-65.59 ms | Same two local GETs. |
| Evaluation input JSON |1008 bytes |1008 bytes | Reconstructed from the actual failed row through installed SDK with HTTP mock. No evidence values removed. |
| Evaluation system instruction |1314 bytes |1025 bytes | Repeated instructions condensed; short output requested. |
| Evaluation JSON schema |1148 bytes,13 top-level fields |Unchanged | Strict schema, backend literals and reference constraints retained. |
| Evaluation SDK request JSON |4100 bytes |3805 bytes | Reduction295 bytes, about7.2%; HTTP headers excluded. |
| Estimated text tokens |581 |509 | UTF-8 input+instruction bytes divided by4; excludes schema, not model tokenization/billing measurement. |
| Gemini transport | Actual failure near60 seconds | No new live measurement | Local TLS/SDK tests passed; they do not predict Google latency. |
| Validation | No narrative reached domain validation in timeout | Correlated timings added; regression passes | Live acceptance/latency untested. |
| Persistence | Failed row exists; no original duration | Correlated database/save+persistence timings added | Mocked write/replay verified; no new real Evaluation row written. |
| API serialization/total | About61 seconds for failed live request | Serialization0.30-0.67 ms; local GET total99.13-158.50 ms | Different operations; not a generation before/after latency comparison. |

Local artifacts, without prompts/credentials: node_modules/.cache/evaluation-timeout/payload-before.json, payload-after.json and local-get-timings.json.

### Comparison with working modules

Measured using their actual builders and installed SDK, fully mocked HTTP, same gemini-3.6-flash configuration:

| Module/input | Input bytes | Instruction bytes | Schema bytes | Request JSON bytes |
| --- | --- | --- | --- | --- |
| Strategist controlled fixture |3446 |1783 |3050 |9056 |
| Blueprint controlled fixture |1853 |1083 |1740 |5296 |
| Evaluation failed-row snapshot, before |1008 |1314 |1148 |4100 |
| Evaluation failed-row snapshot, after |1008 |1025 |1148 |3805 |

Strategist/Blueprint rows are controlled fixtures, not captures of their historical successful calls. Evaluation was already smaller; excessive context is not supported as the cause.

All use shared transport, max_output_tokens4096, store:false, stream:false and one configured attempt. Thinking configuration is omitted. Installed Interactions types support thinking_level, but that does not verify which settings this model endpoint accepts; no thinking override or model change was introduced. Output-token cap and schema bounds remain unchanged to avoid a new truncation failure.

## Changes implemented

- src/lib/ai/gemini-fetch.server.ts: optional dispatcher monitoring now reports dispatch, socket_assigned, request_sent, response_started, response_headers and response_complete. A transparent handler Proxy preserves original method receivers, optional hooks and backpressure. The singleton Agent,30-second connector and Google-origin scope remain.
- src/lib/ai/gemini-json.server.ts: logs safe input/system/schema byte counts, explicitly estimated tokens, current transport phase and per-phase elapsed transport time. Existing timeout, status preservation, abort and retry behavior unchanged.
- src/lib/ai/gemini-debug.server.ts: allowlists new counters/phases and accepts a validated optional internal correlation UUID.
- src/features/campaign-evaluation/performance.ts: small development-only timing helper for authentication, repository operations, context, calculation, prompt, provider, validation, persistence, serialization and total.
- Evaluation contracts.ts/engine.ts/gemini.server.ts: optional internal metadata propagates request UUID separately from the prompt; provider and validation timings; concise instruction with all source/numeric/causal/synthetic safeguards retained. No Zod/domain rule change.
- Evaluation service.ts/api.server.ts: timing around existing operations, correlated through preflight/freshness/readback. Existing ownership, CAS, replay, source checks and failure persistence remain.
- tests/unit/evaluation-payload-size.test.ts and evaluation-performance.test.ts: offline payload measurements and diagnostic gating/privacy.
- tests/integration/evaluation-provider-validation.test.ts:60-second fake-clock abort, failed provenance persistence/replay and correlated phase tests.
- tests/integration/gemini-transport.test.ts: real loopback TLS delayed connection, headers and body, no Google endpoint.

### Meaning and limits of network phases

- dispatch: request handed to Agent; waiting for a connection may include queueing and DNS/TCP/TLS.
- socket_assigned: Undici onConnect before dispatch on the ready socket; local slow-TLS test verifies the delayed handshake path.
- request_sent: Undici completed its local request write. This does not prove Google processed it.
- response_started: HTTP parser observed the start of response bytes (observable approximation of response TTFB, not a packet capture).
- response_headers: headers parsed; response_complete: HTTP body/trailers complete. SDK decoding/validation follows.
- DNS, TCP and TLS are not individually timed. A failure before socket assignment stays in the combined connection/queue phase; error cause codes can provide further evidence. No global socket/DNS instrumentation or data capture added.

Native Node v24.11.0 was inspected. HTTP_PROXY/HTTPS_PROXY/ALL_PROXY/NO_PROXY and NODE_USE_ENV_PROXY were unset in the inspected environment; no configured proxy was demonstrated. The scoped Agent remains direct and does not adopt a different global proxy/dispatcher.

## Tests and verification

Final commands:

~~~text
node_modules/.bin/vitest.cmd run tests/unit tests/integration/evaluation-provider-validation.test.ts tests/integration/remaining-ai-contracts.test.ts tests/integration/blueprint-provider-provenance.test.ts
$env:GEMINI_METADATA_CHECK='0'
node_modules/.bin/vitest.cmd run tests/integration/gemini-transport.test.ts
node_modules/.bin/tsc.cmd --noEmit --incremental false
npm.cmd run lint
npm.cmd run build
~~~

- 597 unit/mocked integration tests passed /30 files.
- 4 real loopback TLS/SDK/Next tests passed;1 real metadata test explicitly skipped. Suite duration43.64 seconds. Total601 passed; no live Google request.
- Loopback proves TLS handshake delayed beyond11.2 seconds succeeds and the connector expires between29.5 and36 seconds when TLS never completes.
- Separate300 ms total-deadline tests distinguish no headers (httpStatus:null, phase request_sent) from headers received/body pending (httpStatus200, phase response_headers). Exactly one HTTP POST/fetch/dispatcher invocation each.
- A body-abort test initially assumed exactly one TLS connection; a second connection can occur while still observing exactly one HTTP request. The corrected test asserts inference-relevant POST/fetch/dispatch count, and does not mistake connection count for generation count.
- Fake-clock60-second application test confirms signal abort, one SDK call, one failed record, no accepted narrative and replay without another generation.
- Legitimate uncertainty, unsupported guarantees, fabricated values, wrong classifications/references, nullable IDs, immutable review and stale-source guards still pass regressions.
- TypeScript, ESLint and final production build all passed, exit0.
- Two local GETs were successful. An initial benchmark parser failed on Next's nested JSON log encoding; decoding the existing JSON-lines correctly recovered the timing records. This was a measurement-script issue, not an API failure.

No fixture-creating integration suite was run against the real-provider server. Local PostgreSQL was read only for campaign/Evaluation data; authentication used existing owner identities locally without external messaging.

## Timeout/architecture decision and remaining risks

Keep the current synchronous MVP with60-second provider deadline and30-second connector. No120-second increase, model swap, thinking setting, output-cap reduction, streaming rewrite, retry, fallback, queue or polling subsystem is justified by one unresolved transport failure. Smaller instructions and shorter requested prose may reduce work, but no specific Google latency improvement is claimed.

A queue/polling design should be reconsidered only if repeated authorized measurements demonstrate healthy delivery but legitimate inference regularly exceeds the synchronous budget, or deployment execution limits demand it. Streaming would improve partial-response visibility but does not guarantee earlier completed/validated output.

Caller/browser disconnect is not propagated as a new domain cancellation command. The provider's existing controller deadline is tested; HTTP/database work has separate bounds. Server/deployment max duration was not verified because this is local development.

A single request and replay produce no automatic duplicate SDK call in tests. Concurrent separate HTTP submissions can both pass the initial missing-row check before CAS; existing database idempotency protects persisted rows, not distributed exactly-once inference. Do not submit the manual retest concurrently or repeatedly.

Underlying Google/network cause, live latency, cost/tier eligibility and post-change domain acceptance remain unverified. Historical failed/rejected rows are not rewritten. Synthetic data remains ineligible as verified production Memory evidence. No review, finalization or Business Memory generation was performed.

## One-request manual Bruno retest

This is a procedure only; **no live request was executed in this task**. Use it only under the applicable explicit quota/no-charge authorization. Do not Run All.

1. Use one server at http://localhost:3000, real Evaluation provider and the existing owner session. Set Bruno timeout to at least90000 ms for observation; this does not extend the backend60-second provider deadline.
2. GET http://localhost:3000/api/dev/evaluations?campaignId=c8f2a641-9b73-4e02-a7d5-61c90b38f254&scenario=exceeds_target with the owner bearer token. Set freshCampaignVersion from context.snapshot.campaign.version, freshContextHash from context.contextHash, and freshExpectedEvaluationIdJson to JSON.stringify(latestEvaluationId), including quotes for a UUID or literal null.
3. Generate a new UUID, e.g. PowerShell [guid]::NewGuid().ToString(), and save it as newEvaluationRequestId. Never reuse5e4d2dba-3a5b-4538-870e-c4ef72b01dcf.
4. Send exactly one POST http://localhost:3000/api/dev/evaluations:

~~~http
Authorization: Bearer {{ownerAccessToken}}
Origin: http://localhost:3000
Content-Type: application/json
Accept: application/json
~~~

~~~json
{
  "action": "generate",
  "campaignId": "c8f2a641-9b73-4e02-a7d5-61c90b38f254",
  "requestId": "{{newEvaluationRequestId}}",
  "expectedCampaignVersion": {{freshCampaignVersion}},
  "expectedContextHash": "{{freshContextHash}}",
  "expectedEvaluationId": {{freshExpectedEvaluationIdJson}},
  "analyticsScenario": "exceeds_target",
  "providerScenario": "valid"
}
~~~

These are Bruno substitution variables; after interpolation the body must be valid JSON with numeric version and nullable/string expectedEvaluationId. Do not send expectedLatestEvaluationId. If using the existing collection cost guard, use its explicit real-generation opt-in for this one request and turn it off afterwards; that guard does not certify free tier.

5. Correlate [GEMINI_DEBUG], [EVALUATION_PERF] and Evaluation output rejected by the new internal UUID. Inspect the last transport phase, response_started/headers/complete timing, HTTP status, provider duration, validation and persistence.
6. Success requires completed upstream, schema/domain acceptance, persisted analysis.status available with Gemini provenance and API reload. HTTP200 alone is insufficient. A timeout must remain failed with no narrative.
7. If testing replay after the first result is known persisted, use the identical payload/UUID and confirm replayed:true with no new SDK_REQUEST STARTED. This is not permission for another fresh generation.
8. Do not review, finalize or generate Memory as part of this retest. A valid result establishes readiness for a separate authorized lifecycle action; synthetic restrictions remain.

Final preservation check:42 protected files remained byte-identical; the two expected changes within the44-file protected set are Evaluation engine timing and its internal provider metadata type. Database failed-row hash and baseline remained unchanged. Secret scan of14 touched files found no configured credential values.
