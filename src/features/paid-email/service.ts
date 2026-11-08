import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { claimJobs, completeJob, failJob, type ClaimedJob } from "@/features/jobs/repository";
import { findPaidEmailFacts } from "@/features/paid-email/repository";
import { EmailSendError, type EmailSender } from "@/features/paid-email/sender.server";
import { buildPaidEmail } from "@/features/paid-email/template";

const EMAIL_BATCH_LIMIT = 20;
// Sewa lebih lama dari batas waktu kirim, agar job tidak diambil worker lain saat masih dikirim.
const EMAIL_LEASE_SECONDS = 60;

export type PaidEmailRunSummary = { sent: number; failed: number };

async function deliver(client: SupabaseClient, sender: EmailSender, job: ClaimedJob): Promise<"sent" | "failed"> {
  if (!job.entityId) {
    await failJob(client, job, "ENTITY_MISSING");
    return "failed";
  }
  try {
    const lookup = await findPaidEmailFacts(client, job.entityId);
    // Job ini dibuat bersama pembayaran yang diterapkan. Bila faktanya tidak ada, jangan kirim email lunas palsu.
    if (lookup.kind !== "ready") {
      await failJob(client, job, lookup.kind === "not_found" ? "ORDER_NOT_FOUND" : "PAYMENT_NOT_APPLIED");
      return "failed";
    }
    // Kunci tetap per pesanan dan versi template, sama dengan dedupe job, sehingga ulangan tidak mengirim dua kali di provider yang mendukung.
    const { providerReference } = await sender.send(buildPaidEmail(lookup.facts), `${job.entityId}:paid-v1`);
    await completeJob(client, job, providerReference);
    return "sent";
  } catch (error) {
    // Hanya kode. Alamat, isi email, dan pesan provider tidak dicatat.
    await failJob(client, job, error instanceof EmailSendError ? error.code : "EMAIL_SEND_FAILED");
    return "failed";
  }
}

/**
 * Mengirim email konfirmasi lunas yang mengantre (FR-EMAIL-01/02). `client` wajib service role. Aman dijalankan bersamaan dan diulang:
 * klaim memakai sewa, percobaan ulang dibatasi `fail_job`, dan kegagalan email tidak pernah mengubah status pembayaran.
 */
export async function runPaidEmailJobs(client: SupabaseClient, sender: EmailSender, limit: number = EMAIL_BATCH_LIMIT): Promise<PaidEmailRunSummary> {
  const jobs = await claimJobs(client, ["send_paid_email"], limit, EMAIL_LEASE_SECONDS);
  const summary: PaidEmailRunSummary = { sent: 0, failed: 0 };
  for (const job of jobs) summary[await deliver(client, sender, job)] += 1;
  return summary;
}
