import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { claimJobs, completeJob, failJob, type ClaimedJob } from "@/features/jobs/repository";
import { findOrderEmailFacts, findOwnerEmail, findPaidEmailFacts } from "@/features/paid-email/repository";
import { EmailSendError, type EmailSender } from "@/features/paid-email/sender.server";
import { buildOwnerPaidOrderEmail, buildPaidEmail, buildPendingPaymentEmail } from "@/features/paid-email/template";

const EMAIL_BATCH_LIMIT = 20;
// Sewa lebih lama dari batas waktu kirim, agar job tidak diambil worker lain saat masih dikirim.
const EMAIL_LEASE_SECONDS = 60;

export type PaidEmailRunSummary = { sent: number; failed: number };
/**
 * Alamat dasar aplikasi dan tautan halaman pesanan per ID pesanan. Tautan hanya ada bila pemicu memegang token di memori
 * (pembeli menekan cek status); job yang diambil cron tanpa token tetap terkirim, hanya tanpa tombol tautan.
 */
export type EmailContext = { appUrl: string | null; logoUrl: string | null; orderUrls?: ReadonlyMap<string, string> };

/** Penjual diberi tahu setelah email pembeli terkirim. Gagal di sini hanya dicatat, agar email pembeli tidak dikirim ulang. */
async function notifyOwner(client: SupabaseClient, sender: EmailSender, facts: Parameters<typeof buildOwnerPaidOrderEmail>[0], businessId: string, context: EmailContext) {
  try {
    const ownerEmail = await findOwnerEmail(client, businessId);
    if (ownerEmail === null) return;
    const dashboardUrl = context.appUrl ? `${context.appUrl}/dashboard/orders/${facts.orderId}` : null;
    await sender.send(buildOwnerPaidOrderEmail(facts, ownerEmail, { dashboardUrl, logoUrl: context.logoUrl }), `${facts.orderId}:owner-paid-v1`);
  } catch (error) {
    console.error("[paid-email] notifikasi penjual gagal", { code: error instanceof EmailSendError ? error.code : "OWNER_EMAIL_FAILED" });
  }
}

async function deliver(client: SupabaseClient, sender: EmailSender, job: ClaimedJob, context: EmailContext): Promise<"sent" | "failed"> {
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
    const orderUrl = context.orderUrls?.get(job.entityId) ?? null;
    const { providerReference } = await sender.send(buildPaidEmail(lookup.facts, { orderUrl, logoUrl: context.logoUrl }), `${job.entityId}:paid-v1`);
    await completeJob(client, job, providerReference);
    await notifyOwner(client, sender, lookup.facts, lookup.businessId, context);
    return "sent";
  } catch (error) {
    // Hanya kode. Alamat, isi email, dan pesan provider tidak dicatat.
    await failJob(client, job, error instanceof EmailSendError ? error.code : "EMAIL_SEND_FAILED");
    return "failed";
  }
}

/**
 * Mengirim email konfirmasi lunas yang mengantre (FR-EMAIL-01/02) beserta notifikasi penjual. `client` wajib service role.
 * Aman dijalankan bersamaan dan diulang: klaim memakai sewa, percobaan ulang dibatasi `fail_job`, dan kegagalan email tidak
 * pernah mengubah status pembayaran.
 */
export async function runPaidEmailJobs(client: SupabaseClient, sender: EmailSender, limit: number = EMAIL_BATCH_LIMIT,
  context: EmailContext = { appUrl: null, logoUrl: null }): Promise<PaidEmailRunSummary> {
  const jobs = await claimJobs(client, ["send_paid_email"], limit, EMAIL_LEASE_SECONDS);
  const summary: PaidEmailRunSummary = { sent: 0, failed: 0 };
  for (const job of jobs) summary[await deliver(client, sender, job, context)] += 1;
  return summary;
}

/**
 * Email "menunggu pembayaran" tepat setelah checkout. Tidak lewat antrean karena tautannya memakai token yang hanya ada di
 * memori saat itu; kunci idempoten provider mencegah dobel bila checkout diulang. Pesanan yang sudah lunas tidak dikirimi.
 */
export async function sendPendingPaymentEmail(client: SupabaseClient, sender: EmailSender, orderId: string, context: EmailContext & { orderUrl: string | null }): Promise<"sent" | "skipped"> {
  const lookup = await findOrderEmailFacts(client, orderId);
  if (lookup.kind !== "found" || lookup.paid) return "skipped";
  await sender.send(buildPendingPaymentEmail(lookup.facts, { orderUrl: context.orderUrl, logoUrl: context.logoUrl }), `${orderId}:pending-v1`);
  return "sent";
}
