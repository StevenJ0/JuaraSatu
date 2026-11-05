import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { expireOrder } from "@/features/orders/service";
import { claimJobs, completeJob, enqueueExpireJobs, failJob, type ClaimedJob } from "@/features/jobs/repository";

const EXPIRE_BATCH_LIMIT = 50;
const EXPIRE_LEASE_SECONDS = 60;

export type ExpireRunSummary = { enqueued: number; expired: number; skipped: number; failed: number };

async function runExpireJob(client: SupabaseClient, job: ClaimedJob): Promise<"expired" | "skipped" | "failed"> {
  if (!job.entityId) {
    await failJob(client, job, "ENTITY_MISSING");
    return "failed";
  }

  try {
    const outcome = await expireOrder(client, job.entityId, null);
    await completeJob(client, job);
    // Pesanan bisa sudah lunas atau dibatalkan saat job berjalan. Itu keadaan sah, jadi job tetap selesai tanpa diulang.
    return outcome.kind === "ok" ? "expired" : "skipped";
  } catch {
    await failJob(client, job, "EXPIRE_FAILED");
    return "failed";
  }
}

/**
 * Merapikan pesanan yang tenggat bayarnya lewat. `client` wajib service role. Dipanggil scheduler dan aman diulang.
 * Slot yang lewat tenggat sudah tidak terhitung walau ini terlambat, jadi kapasitas tidak bergantung pada jadwal scheduler.
 */
export async function runExpireJobs(client: SupabaseClient, limit: number = EXPIRE_BATCH_LIMIT): Promise<ExpireRunSummary> {
  const enqueued = await enqueueExpireJobs(client, limit);
  const jobs = await claimJobs(client, ["expire"], limit, EXPIRE_LEASE_SECONDS);
  const summary: ExpireRunSummary = { enqueued, expired: 0, skipped: 0, failed: 0 };
  for (const job of jobs) summary[await runExpireJob(client, job)] += 1;
  return summary;
}
