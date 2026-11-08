import assert from "node:assert/strict";

// Reviewed source inventory, independent of database introspection. Update explicitly when the chain changes.
export const ACTIVE_MIGRATIONS = [
  "20261103000000_initial_v21.sql",
  "20261103090000_atomic_campaign_blueprint_creation.sql",
  "20261104090000_evaluation_cas_and_finalization.sql",
  "20261104091000_seal_completed_campaign_updates.sql",
  "20261104092000_reject_synthetic_finalization_memory_approval.sql",
  "20261104093000_memory_approval_and_indexing_transactions.sql",
  "20261104094000_memory_index_recovery.sql",
  "20261106090000_memory_generation_type.sql",
  "20261106100000_atomic_ai_generation_admission.sql",
  "20261106160000_core_preorder_on_v21.sql",
  "20261107090000_generic_job_acknowledgement_guards.sql",
  "20261107100000_job_claim_isolation.sql",
  "20261107110000_canonical_preorder_publication.sql",
  "20261108090000_financial_bounds_owner_cas.sql",
];

export function verifyMigrationInventory(files) {
  assert.equal(new Set(files.map(f=>f.split("_")[0])).size,files.length,"Duplicate migration timestamp");
  assert.deepEqual(files,ACTIVE_MIGRATIONS,"Missing, reordered or unreviewed root migration; update the test contract explicitly");
}
