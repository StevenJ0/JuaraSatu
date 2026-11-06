# Conditional and blocked coverage

- Verified memory approval/indexing/available retrieval: BLOCKED by real C6/C7 authority; synthetic approval must return409. No privileged RPC requests exist here.
- Real Gemini text/embedding: not requested by this collection; Fake flags must remain enabled. Existing embedding smoke failed; no paid test is authorized by this collection.
- Recovery success: real persisted running generation older than120seconds; opt-in allowRecovery. No fake claim/timestamp/SQL workaround.
- Expired dates/conflicting publication/source-revision invalidation/database outage: use dedicated synthetic campaigns and existing integration/browser/SQL suites; do not alter shared fixture dates or shut down a user database just to force an error.
- Current memory unavailable can be observed if provider/database/attestation is unavailable; do not mislabel it cold-start. Deterministic available/no-match/worker failure tests live in tests/unit/memory-*.test.ts and isolated database/v2.1/tests/memory-transactions.mjs.
- Pricing/simulator/context standalone REST, production checkout/payment/customer APIs and Server Actions: absent.
- No proposalId/alternativeId API fields: use persisted selection generationId/proposalVersion/proposalKey.
