import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "../../src/lib/supabase/database.types";
import type { AiAdmissionArgs, SupabaseTransport } from "../../src/lib/supabase/transport.server";

type Tables = Database["public"]["Tables"];
type Rpc = Database["public"]["Functions"];
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;
type CorePublish = Extract<Rpc["publish_preorder"], { Returns: undefined }>;
type LegacyPublish = Extract<Rpc["publish_preorder"], { Args: { p_business_id: string } }>;
type CoreClaim = Extract<Rpc["claim_jobs"], { Args: { p_job_types: string[] } }>;
type CorePayment = Extract<Rpc["apply_verified_payment"], { Args: { p_provider_event_key: string } }>;
type LegacyPayment = Extract<Rpc["apply_verified_payment"], { Args: { p_payment_id: string } }>;

export type DatabaseContractAssertions = [
  Assert<Equal<Tables["businesses"]["Row"]["categories"], string[]>>,
  Assert<Equal<undefined extends Tables["businesses"]["Insert"]["categories"] ? true : false, false>>,
  Assert<Equal<Tables["businesses"]["Update"]["categories"], string[] | undefined>>,
  Assert<Equal<CorePublish["Args"], { p_preorder_id: string; p_expected_version: number }>>,
  Assert<Equal<LegacyPublish["Returns"], Tables["preorders"]["Row"]>>,
  Assert<Equal<CoreClaim["Returns"], Json>>,
  Assert<Equal<CorePayment["Returns"], Json>>,
  Assert<Equal<LegacyPayment["Returns"], string>>,
  Assert<Equal<CorePayment["Args"]["p_amount_idr"], number>>,
  Assert<Equal<"p_event_key" extends keyof CorePayment["Args"] ? true : false, false>>,
  Assert<Equal<Rpc["complete_job"]["Returns"], boolean>>,
  Assert<Equal<Rpc["claim_memory_jobs"]["Returns"][number], Tables["job_runs"]["Row"]>>,
  Assert<Equal<Rpc["complete_memory_index_job"]["Returns"], undefined>>,
  Assert<Equal<Rpc["claim_ai_generation"]["Returns"], Json>>,
  Assert<Equal<Rpc["admit_ai_generation"]["Returns"], Json>>,
  Assert<Equal<Rpc["create_campaign_with_initial_blueprint"]["Returns"], Tables["campaign_blueprints"]["Row"]>>,
  Assert<Equal<Rpc["finalize_campaign_evaluation"]["Returns"], string>>,
  Assert<Equal<null extends AiAdmissionArgs["p_session_id"] ? true : false, true>>,
  Assert<Equal<"p_job_types_typo" extends keyof CoreClaim["Args"] ? true : false, false>>,
  Assert<Equal<"category_ids" extends keyof Tables["businesses"]["Row"] ? true : false, false>>,
  Assert<Equal<"private" extends keyof Database ? true : false, false>>,
  Assert<Equal<{ p_preorder_id: string; p_expected_version: string } extends CorePublish["Args"] ? true : false, false>>
];

// Compile-only: never invoked, so these SDK calls cannot contact a database or execute workers.
export function verifySdkContracts(client: SupabaseClient<Database>, transport: SupabaseTransport) {
  const id = "11111111-1111-4111-8111-111111111111";
  const core = client.rpc("publish_preorder", { p_preorder_id: id, p_expected_version: 1 }).then(result => {
    const value: undefined | null = result.data;
    return value;
  });
  const legacy = client.rpc("publish_preorder", { p_business_id: id, p_preorder_id: id, p_expected_version: 1 }).then(result => {
    const value: Tables["preorders"]["Row"] | null = result.data;
    return value;
  });
  const typedClaim = client.rpc("claim_jobs", { p_job_types: ["expire"], p_limit: 1, p_lease_seconds: 60 }).then(result => {
    const value: Json = result.data;
    return value;
  });
  const memory = client.rpc("claim_memory_jobs", { p_business_id: id, p_model: "compile-only", p_profile: "768", p_embedding_version: 1 });
  const complete = client.rpc("complete_job", { p_job_id: id, p_attempt: 1 });
  const fail = client.rpc("fail_job", { p_job_id: id, p_attempt: 1, p_error_code: "TEST_ONLY" });
  const payment = client.rpc("apply_verified_payment", { p_provider_order_id: id, p_provider_event_key: id, p_payload_hash: "a".repeat(64),
    p_provider_status: "settlement", p_provider_transaction_id: id, p_amount_idr: 1, p_provider_paid_at: "2026-11-07T00:00:00Z" }).then(result => {
    const value: Json = result.data;
    return value;
  });
  const business = client.from("businesses").insert({ name: "Compile only", slug: "compile-only", category: "Fashion", categories: ["Fashion"], pickup_instructions: "Compile only" });
  const admission = transport.rpc("admit_ai_generation", { p_business_id: id, p_actor_user_id: id, p_generation_id: id,
    p_generation_type: "memory", p_request_key: id, p_input_hash: "a".repeat(64), p_model_id: "compile-only", p_preorder_id: id,
    p_session_id: null, p_expected_version: null, p_context_hash: null, p_message: null,
    p_minute_key_hash: "b".repeat(64), p_hour_key_hash: "c".repeat(64), p_day_key_hash: "d".repeat(64), p_daily_limit: 100 });
  return { core, legacy, typedClaim, memory, complete, fail, payment, business, admission };
}
