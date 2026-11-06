# Slice 5 — atomic creation capability gap

**Resolved by explicit user approval:** one additive RPC authorized during Slice 5. Implemented in `20261103090000_atomic_campaign_blueprint_creation.sql`; no table/column change. Initial migration remains untouched. The remaining notes record why the extra permission was necessary.

Existing `save_campaign_draft` creates a campaign but has no source-proposal argument or provenance persistence. `campaigns.baseline_json` is reserved for publication baseline and must not be repurposed. Existing `save_blueprint_revision` requires an existing campaign, then atomically stores provenance in the blueprint and sets the active pointer.

Two independent HTTP RPC calls cannot atomically create a sourced campaign plus its initial blueprint. A failure between calls leaves an unbound campaign. Client state, a process-local mutex, encoding provenance in the title/slug, or compensating deletion do not satisfy the requested contract.

Proposed separately authorized database capability: `create_campaign_with_initial_blueprint`.

- Inputs: business/preorder/campaign/blueprint UUIDs, validated draft JSON, validated blueprint JSON, context hash, source generation UUID, trusted actor UUID, expected source versions.
- No additional table/column required; provenance and immutable request fingerprint fit the approved `campaign_blueprints.blueprint_json`.
- Trusted server only; verify owner and tenant/preorder/generation relationships.
- Lock capacity → preorder/item/product, consistent with existing RPCs; compare source versions.
- On first application call existing draft/revision functions within the SAME PostgreSQL transaction.
- Same campaign/blueprint IDs plus matching fingerprint replay without writes; changed payload conflicts. Concurrent duplicates serialize before checking replay.
- Failure rolls back campaign, blueprint and pointer together. No approval or publication.

The user explicitly authorized this single function, and the additive migration has been applied to the local project only. Existing `save_blueprint_revision` and `approve_blueprint` remain unchanged and handle revision/approval with application-side validation and read-after-conflict replay handling.

Other adapter differences:

- SQL creation expects `p_expected_version=NULL`; generated RPC args expose `number`. The new wrapper supplies SQL NULL internally, avoiding a TypeScript assertion or a handwritten edit to generated types.
- `save_blueprint_revision` is not natively request-replay aware. Use a stable blueprint UUID, fingerprint inside its validated JSON and read-after-conflict reconciliation; all writes remain inside the single existing RPC.
- `approve_blueprint` takes source/campaign versions, not an explicit blueprint version. Application must verify selected ID/version is the active persisted version before calling it. Its approved replay fast path skips expected versions, so application freshness checks remain mandatory.

No migration or database object is changed by this document.
