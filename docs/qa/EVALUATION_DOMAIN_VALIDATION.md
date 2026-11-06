# Evaluation domain validation - 5 November 2026

## Decision recorded before implementation

The domain rule remains unchanged: reject unsupported guaranteed outcomes, causal attribution, fabricated numerical facts, financial authority and evidence. The previous substring implementation incorrectly treated **ketidakpastian** and **belum dapat dipastikan** as affirmative certainty. Correct it using normalized whole words and narrowly bounded adjacent negation. Negation must not cross punctuation, fields or another assertion; a separate affirmative guarantee still rejects the narrative. Causal restrictions remain conservative rather than introducing a general-purpose language parser.

The value-free narrative contract remains: KPI and financial values come from calculateEvaluation and immutable context, never model fields. Normalize Unicode before checking and reject written measurement/currency quantities. No database/schema, ownership, CAS, lifecycle, synthetic eligibility, environment, model or shared Strategist/Blueprint changes are required.

## 1. Root cause: confirmed versus unknown

**Confirmed:** validateEvaluationNarrative in [engine.ts](../../src/features/campaign-evaluation/engine.ts) used a joined-prose regex containing unbounded pasti, dijamin and guarantee. Consequently ketidakpastian, dipastikan, belum pasti and tidak dijamin failed as unsafe_prose. Positive classification phrase matching also rejected legitimate negations such as Tidak semua tugas selesai. ASCII-only digit matching did not cover Unicode digits. Whole-word corrections must retain morphology such as pastinya and kepastian; simply adding word boundaries around pasti would introduce false negatives.

**Confirmed diagnostic gap:** the previous rejection log lacked a field path and internal request correlation. A generic wrapper parse also discarded an otherwise valid provider ID if the nested narrative schema failed. Wrapper validation now remains strict, captures provenance first, then validates the narrative separately.

**Unknown:** the exact causes of the two historical real Gemini rejections. Both completed and parsed JSON, but old logs were insufficient and rejected prose was not retained. These records have not been edited; no assertion is made that the substring bug caused those specific failures.

### Complete validation pipeline and rejection inventory

| Check class | Actual functions and failure mechanisms |
| --- | --- |
| Structural/schema | configuredEvaluationProvider parses provider text as JSON; invalid JSON is INVALID_AI_EVALUATION. Shared createGeminiJsonProvider rejects malformed/incomplete/refused interactions. interpretEvaluation validates the wrapper and nullable provider ID; EvaluationNarrativeSchema.parse rejects unknown keys, missing/wrong fields, invalid enums, empty/overlong text and out-of-bound lists. Text is trimmed and bounded to six hundred characters; lists and references retain their original bounds. |
| Backend-controlled fields | evaluationAssessments derives outcome from achievementBps, finance from contributionIdr and execution from executionBps. All three must exactly match. Provider JSON schema uses literal backend states, never model-selected authority. |
| Evidence/references | Evidence must belong to the schema enum and current context.references. For example c6 is invalid when analytics is unavailable even though it is a recognized reference name. At least one bounded reference is required; arbitrary citations/IDs fail. |
| Financial/KPI consistency | calculateEvaluation validates source context, uses integer/BigInt arithmetic, reviewed nonvoid costs, and explicit nulls for unknown facts. Narrative schema permits no extra authoritative financial fields. Digits, currency and written measurement quantities are rejected in prose. evaluationHandoff rebuilds context/hash, recalculates summary, and rejects tampered financial/source snapshots as INVALID_SNAPSHOT. It also revalidates stored narratives. |
| Narrative safety/claims | validateEvaluationNarrative checks every prose field/list element individually. It rejects unnegated certainty, known unsupported causal phrasing, real-revenue claims, and positive target/contribution/completion assertions that conflict with backend states. Normalized Unicode and double-negation tests prevent simple bypasses. All original affirmative claim guards remain. |
| Source/lifecycle | buildEvaluationContext checks closed/completed lifecycle, materialized approved source bindings, cost ownership, measurement window, C6 identity/version/window and freshness. evaluationService.generate requires closed status, version/hash/latest-evaluation CAS before inference and rechecks source after inference; repository save invokes database CAS. These are independent of narrative validity. |
| Persistence/replay/review | Same command/request ID replays stored results; different payload conflicts. Invalid output persists as invalid with null narrative and truthful Gemini metadata. Review requires an available narrative and current source; review appends a new row. Owner review/finalization eligibility is unchanged. |

Not every rejection means a provider bug: syntactically valid JSON may correctly fail any applicable schema, evidence, classification, safety or freshness check.

## 2. Changes and navigation

Production changes are limited to three Evaluation files:

- [engine.ts](../../src/features/campaign-evaluation/engine.ts): hasAffirmativeClaim handles bounded negation, morphology and a limited uncertainty suffix; proseRejection normalizes NFKC/format characters and identifies a stable rejection category; validateEvaluationNarrative retains strict schema/evidence/backend checks and reports the specific field/index.
- interpretEvaluation in the same file validates the wrapper before the nested narrative, retaining a valid Google ID on schema rejection. Missing Google ID remains null. logRejection emits JSON with stage, static category/code, allowlisted fieldPath, UUID requestId, safe mismatch booleans and schema issue count/code. It logs no narrative, raw key names, prompts, business values, cookies, tokens or provider response. Development plus GEMINI_DEBUG=true is still required.
- [service.ts](../../src/features/campaign-evaluation/service.ts): generate passes its validated command.requestId into interpretEvaluation. Ownership, replay, freshness checks, persistence and lifecycle logic remain in place.
- [gemini.server.ts](../../src/features/campaign-evaluation/gemini.server.ts): prompt explicitly permits genuine uncertainty; removes the instruction to avoid ketidakpastian. It keeps prose value-free and causal/real-cash claims prohibited. Existing schema literals and allowed evidence references remain backend-controlled.

Tests changed/added:

- [evaluation-narrative-safety.test.ts](../../tests/unit/evaluation-narrative-safety.test.ts): fifty-four language/classification/reference cases.
- [gemini-remaining-modules.test.ts](../../tests/unit/gemini-remaining-modules.test.ts): eighteen installed-SDK/mocked-HTTP cases, including safe diagnostics, nullable ID, malformed schema/JSON, incomplete/refused responses and one-attempt behavior. Existing Memory cases retained.
- [evaluation-provider-validation.test.ts](../../tests/integration/evaluation-provider-validation.test.ts): ten SDK/workflow integration cases using mocked HTTP and a repository port, with valid/invalid persistence, immutable review append, replay, stale source/version/latest ID, financial tampering and actual service request-ID propagation.

### Actual E2E call order

POST /api/dev/evaluations action generate -> evaluationPost -> boundary/authenticateDiscussion (development guard, Supabase owner identity/membership) -> checkWriteOrigin and ActionSchema -> evaluationService.generate -> request-ID replay -> context -> evaluationRepository.facts -> buildEvaluationContext/syntheticCampaignAnalytics -> calculateEvaluation -> configuredEvaluationProvider -> shared createGeminiJsonProvider/interactions.create -> wrapper/Zod/domain validation -> fresh-context check -> repository.save/record_campaign_evaluation_cas -> view/history/evaluationHandoff -> HTTP response.

Provider rejection is represented in persisted analysis status failed/invalid, with no accepted narrative. An HTTP200 application response alone is not success. Owner review goes through the separate review action and requires available output. Finalization and Memory generation were not executed.

## 3. Validation matrix

Examples below describe the changed field within an otherwise valid, grounded narrative:

| Indonesian narrative | Expected result |
| --- | --- |
| Terdapat ketidakpastian hasil promosi. | Accept |
| Hasil ini belum dapat dipastikan. | Accept |
| Hasil ini tidak dapat dipastikan. | Accept |
| Peningkatan penjualan tidak dijamin. | Accept |
| Tidak ada kepastian hasil promosi. | Accept |
| Tidak semua tugas selesai. | Accept for incomplete checklist |
| Kontribusi positif belum dapat dipastikan. | Accept when finance is unknown |
| Penjualan pasti meningkat. | Reject guaranteed_outcome |
| Penjualan pastinya meningkat. | Reject guaranteed_outcome |
| Ada kepastian penjualan meningkat. | Reject guaranteed_outcome |
| Penjualan bukan tidak pasti meningkat. | Reject double negation |
| Tidak ada bukti; penjualan pasti meningkat. | Reject; negation does not exempt another clause |
| Negation in summary, affirmative certainty in another field | Reject |
| Unicode full-width or zero-width variants of pasti | Reject |
| Penjualan mencapai 999 unit / Unicode digits | Reject numeric_claim |
| Pendapatan mencapai seribu rupiah. | Reject numeric_claim |
| Penjualan mencapai dua belas unit. | Reject numeric_claim |
| Campaign menyebabkan peningkatan penjualan. | Reject causal_claim |
| Penjualan meningkat karena kampanye. | Reject causal_claim |
| Kampanye meningkatkan penjualan. | Reject causal_claim |
| Target tercapai, when below target | Reject contradictory_claim |
| Positive contribution or completed checklist claim contradicting backend | Reject contradictory_claim |
| Structurally valid but backend-inconsistent classification | Reject classification_mismatch |
| Unavailable c6 or fabricated reference | Reject domain/schema validation |

No arbitrary negation waiver or rewriting of rejected output is used. Causal terms remain conservatively prohibited even in some disclaimers; the prompt explicitly avoids them.

## 4. Test evidence

Final checks on 5 November 2026:

| Command/check | Actual result |
| --- | --- |
| node_modules/.bin/vitest.cmd run tests/unit tests/integration/evaluation-provider-validation.test.ts tests/integration/remaining-ai-contracts.test.ts tests/integration/blueprint-provider-provenance.test.ts | PASS: **590 tests /28 files**;574 unit tests +16 mocked integration cases |
| node_modules/.bin/tsc.cmd --noEmit --incremental false | PASS, exit0 |
| npm.cmd run lint | PASS, exit0 |
| npm.cmd run build | PASS, exit0; Evaluation and Memory dynamic routes included |
| Protected-file SHA256 comparison | PASS:41 files unchanged, including Strategist/Blueprint sources, .env.local, schema, migrations and package/lock files |
| Read-only local PostgreSQL check | Campaign closed v9, same active Blueprint and baseline; two historical Gemini rows still invalid/unreviewed; memory count0 |

The new integration tests deliberately mock HTTP and repository I/O; they are not proof of live Gemini or a newly exercised PostgreSQL write transaction. Legacy fixture-creating HTTP/database suites were not run against the real-provider server because their setup may trigger unrelated generation/mutations. Existing database CAS/RLS implementation was read, left unchanged and not re-certified in this task.

Local runtime evidence: baseline MD5 478a55ab7790c2a1f9d5577dda74011d; active Blueprint f3c871b2-42a6-4e9d-8b13-65d90a2f7c48. Historical Evaluation IDs 3101ef31-50df-45d5-b012-b79c7a3ddeb1 and 4f2d7c05-c04f-4f4e-aadc-509c851dd3ba remain invalid and unreviewed.

## 5. Live readiness and safe retest

**Technically ready for an explicitly authorized smoke; live verification BLOCKED.** Zero live Gemini/embedding calls were made in this task. Earlier conditional free-tier permission is not treated as unconditional authorization, and model metadata cannot guarantee this key has no billing exposure.

After fresh explicit authorization satisfying the no-charge condition:

1. Use the existing owner session and one local server. GET /api/dev/evaluations?campaignId=c8f2a641-9b73-4e02-a7d5-61c90b38f254&scenario=exceeds_target. Read current campaign version, contextHash and latestEvaluationId; do not assume they remain unchanged.
2. POST the same route with action generate, that campaignId, a **new requestId**, current expectedCampaignVersion/contextHash/latestEvaluationId, analyticsScenario exceeds_target and providerScenario valid. Send the matching Origin. Do not reuse either rejected request ID for a new generation.
3. Inspect the row with that new ID: provider gemini, correct model/generatedAt, nullable providerRequestId, status available, grounded narrative and unchanged deterministic metrics. HTTP200 alone is insufficient.
4. If rejected, inspect Evaluation output rejected JSON by requestId/stage/category/fieldPath; leave the immutable result intact and do not automatically retry.
5. Owner review is a separate action only after available output and fresh source. Do not finalize or generate Memory until all genuine lifecycle/eligibility prerequisites and scope permissions are satisfied. Synthetic sources remain ineligible for production memory approval/activation.

## 6. Remaining status

- **FIXED:** demonstrated uncertainty false positives, Unicode/word-boundary bypasses, diagnostic field path/correlation and provenance retention on narrative-schema rejection.
- **PASSED WITH MOCKS:** language validation, schema/prompt alignment, nullable IDs, rejection persistence/replay, review and stale-source protections.
- **FAILED historically:** two prior real Evaluation outputs were rejected. Exact original causes remain unknown.
- **NOT TESTED:** live acceptance after this correction, new PostgreSQL writes/races/RLS transactions, arbitrary semantic truth of unrestricted natural language.
- **BLOCKED:** new live smoke authorization/no-charge certainty; valid finalized Evaluation; live Business Memory generation and production activation.

These are bounded deterministic guards, not a universal Indonesian-language guarantee/causality verifier. Alternative paraphrases can still require owner review, and conservative checks can reject some legitimate wording. Do not declare Real Gemini Evaluation E2E PASS until a real response passes validation and is persisted successfully.
