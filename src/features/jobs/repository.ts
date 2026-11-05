import "server-only";
import { z } from "zod";
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";

export class JobRepositoryError extends Error {
  constructor(
    operation: string,
    readonly code: string | undefined,
  ) {
    super(`Job repository gagal: ${operation}${code ? ` (${code})` : ""}`);
    this.name = "JobRepositoryError";
  }
}

function fail(operation: string, error: PostgrestError): never {
  throw new JobRepositoryError(operation, error.code);
}

export const JOB_TYPES = ["expire", "reconcile", "embed_memory", "send_paid_email"] as const;
export type JobType = (typeof JOB_TYPES)[number];

const claimedJobSchema = z.object({
  id: z.uuid(),
  job_type: z.enum(JOB_TYPES),
  entity_id: z.uuid().nullable(),
  business_id: z.uuid().nullable(),
  attempt_count: z.number(),
});

export type ClaimedJob = {
  id: string;
  type: JobType;
  entityId: string | null;
  businessId: string | null;
  /** Wajib dikirim balik saat menyelesaikan job, agar worker yang sewanya sudah lewat tidak menimpa hasil worker lain. */
  attempt: number;
};

export async function claimJobs(client: SupabaseClient, types: readonly JobType[], limit: number, leaseSeconds: number): Promise<ClaimedJob[]> {
  const { data, error } = await client.rpc("claim_jobs", { p_job_types: types, p_limit: limit, p_lease_seconds: leaseSeconds });
  if (error) fail("claimJobs", error);
  return z
    .array(claimedJobSchema)
    .parse(data)
    .map((row) => ({ id: row.id, type: row.job_type, entityId: row.entity_id, businessId: row.business_id, attempt: row.attempt_count }));
}

/** False berarti sewa sudah lepas dan job dipegang worker lain. Hasil worker ini diabaikan. */
export async function completeJob(client: SupabaseClient, job: Pick<ClaimedJob, "id" | "attempt">, providerReference: string | null = null): Promise<boolean> {
  const { data, error } = await client.rpc("complete_job", { p_job_id: job.id, p_attempt: job.attempt, p_provider_reference: providerReference });
  if (error) fail("completeJob", error);
  return z.boolean().parse(data);
}

const failedJobStatusSchema = z.enum(["retryable_failed", "dead"]).nullable();

/** `errorCode` hanya kode huruf besar, jangan isi data pelanggan atau pesan provider. Null berarti sewa sudah lepas. */
export async function failJob(
  client: SupabaseClient,
  job: Pick<ClaimedJob, "id" | "attempt">,
  errorCode: string,
  providerReference: string | null = null,
): Promise<z.infer<typeof failedJobStatusSchema>> {
  const { data, error } = await client.rpc("fail_job", { p_job_id: job.id, p_attempt: job.attempt, p_error_code: errorCode, p_provider_reference: providerReference });
  if (error) fail("failJob", error);
  return failedJobStatusSchema.parse(data);
}

export async function enqueueExpireJobs(client: SupabaseClient, limit: number): Promise<number> {
  const { data, error } = await client.rpc("enqueue_expire_jobs", { p_limit: limit });
  if (error) fail("enqueueExpireJobs", error);
  return z.number().parse(data);
}
