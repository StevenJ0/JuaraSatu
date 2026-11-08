// Uji FR-EMAIL-01/02 terhadap Supabase lokal sungguhan: job email lunas dibuat atomik oleh pembayaran, lalu dikirim worker.
// Satu uji mengirim ke Mailpit milik stack uji. Sisanya memakai pengirim tiruan untuk ulangan, kegagalan, dan kirim bersamaan.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { publicOrderSchema } from "@/features/orders/schemas";
import { createPrivateOrderToken, placePublicOrder } from "@/features/orders/service";
import { EmailSendError, createMailpitSender, type EmailSender } from "@/features/paid-email/sender.server";
import { runPaidEmailJobs } from "@/features/paid-email/service";
import type { EmailMessage } from "@/features/paid-email/template";
import { applyVerifiedPayment, claimPaymentAttempt } from "@/features/payments/service";
import { cleanupOwners, createOwner, createPublishedPreorder, service, sha256, sql, type Owner, type PreorderFixture } from "./helpers";

const stamp = Date.now();
const PREFIX = "eml";
const MAILPIT = process.env.TEST_MAILPIT_URL ?? "http://127.0.0.1:54424";
let A: Owner;
let target: PreorderFixture;

beforeAll(async () => {
  A = await createOwner(PREFIX, "a", stamp);
  target = createPublishedPreorder(A, PREFIX, stamp, { quota: 30, capacity: 30 });
});

afterAll(() => {
  cleanupOwners(PREFIX, stamp);
});

let count = 0;
async function order({ pay }: { pay: boolean }) {
  count += 1;
  const token = createPrivateOrderToken();
  const email = `${PREFIX}-buyer-${stamp}-${count}@example.com`;
  const placed = await placePublicOrder(service, publicOrderSchema.parse({ slug: target.slug, idempotencyKey: `${PREFIX}-key-${stamp}-${count}-abcdef`, privateToken: token,
    customerName: `Pembeli ${count}`, customerEmail: email, customerContact: "", quantity: 2, expectedUnitPriceIdr: 120000 }), 900);
  if (placed.kind !== "ok") throw new Error(`order: ${placed.violation}`);
  if (pay) {
    const claimed = await claimPaymentAttempt(service, token);
    if (claimed.kind !== "ok") throw new Error("claim");
    const applied = await applyVerifiedPayment(service, { providerOrderId: claimed.value.providerOrderId, providerEventKey: `${PREFIX}-evt-${stamp}-${count}`,
      payloadHash: sha256(`${PREFIX}-${stamp}-${count}`), providerStatus: "settlement", providerTransactionId: null, amountIdr: 240000, providerPaidAt: new Date().toISOString() });
    if (applied.kind !== "ok" || applied.value.outcome !== "applied") throw new Error("apply");
  }
  return { id: placed.value.orderId, email, number: sql(`select public_order_number from public.orders where id = '${placed.value.orderId}'`) };
}

const job = (orderId: string) => sql(`select status || '|' || attempt_count || '|' || coalesce(last_error_code, '-') || '|' || (provider_reference is not null)
  from public.job_runs where job_type = 'send_paid_email' and entity_id = '${orderId}'`);

/** Pengirim tiruan yang mencatat penerima. `fail` membuat semua kirim gagal sementara. */
function fakeSender(fail = false): EmailSender & { sent: EmailMessage[] } {
  const sent: EmailMessage[] = [];
  return {
    sent,
    async send(message) {
      if (fail) throw new EmailSendError("EMAIL_PROVIDER_UNAVAILABLE");
      sent.push(message);
      return { providerReference: `fake-${sent.length}` };
    },
  };
}

async function mailpitMessages(to: string): Promise<{ Subject: string; ID: string }[]> {
  const response = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`);
  const body: unknown = await response.json();
  if (typeof body !== "object" || body === null || !("messages" in body) || !Array.isArray(body.messages)) return [];
  return body.messages.flatMap((message: unknown) =>
    typeof message === "object" && message !== null && "Subject" in message && "ID" in message && typeof message.Subject === "string" && typeof message.ID === "string"
      ? [{ Subject: message.Subject, ID: message.ID }] : []);
}

describe("email konfirmasi lunas", () => {
  it("pembayaran yang diterapkan mengirim tepat satu email ke Mailpit dengan rincian pesanan, ulangan worker tidak mengirim lagi", async () => {
    const paid = await order({ pay: true });
    expect(job(paid.id)).toBe("queued|0|-|false");
    const sender = createMailpitSender(MAILPIT, "noreply@juarasatu.local");
    await runPaidEmailJobs(service, sender);
    expect(job(paid.id)).toBe("succeeded|1|-|true");
    await runPaidEmailJobs(service, sender);
    const messages = await mailpitMessages(paid.email);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.Subject).toBe(`Pembayaran pesanan ${paid.number} terverifikasi (simulasi Sandbox)`);
    const detail: unknown = await (await fetch(`${MAILPIT}/api/v1/message/${messages[0]?.ID}`)).json();
    const text = typeof detail === "object" && detail !== null && "Text" in detail && typeof detail.Text === "string" ? detail.Text : "";
    expect(text).toContain("Total dibayar: Rp240.000");
    expect(text).toContain("simulasi pembayaran Midtrans Sandbox");
    expect(text).not.toContain("/o/");
  });

  it("provider gagal: job dicoba ulang nanti dan status pembayaran tidak berubah", async () => {
    const paid = await order({ pay: true });
    await runPaidEmailJobs(service, fakeSender(true));
    expect(job(paid.id)).toBe("retryable_failed|1|EMAIL_PROVIDER_UNAVAILABLE|false");
    expect(sql(`select order_status from public.orders where id = '${paid.id}'`)).toBe("awaiting_confirmation");
    expect(sql(`select next_run_at > now() from public.job_runs where job_type = 'send_paid_email' and entity_id = '${paid.id}'`)).toBe("t");
    // Lewati jeda percobaan ulang, seolah cron berjalan beberapa saat kemudian.
    sql(`begin; set local session_replication_role = replica; update public.job_runs set next_run_at = now() where job_type = 'send_paid_email' and entity_id = '${paid.id}'; commit;`);
    const working = fakeSender();
    await runPaidEmailJobs(service, working);
    expect(job(paid.id)).toBe("succeeded|2|-|true");
    expect(working.sent.filter((message) => message.to === paid.email)).toHaveLength(1);
  });

  it("job untuk pesanan yang belum lunas tidak mengirim email lunas", async () => {
    const pending = await order({ pay: false });
    sql(`insert into public.job_runs (job_type, entity_id, business_id, dedupe_key, status) values ('send_paid_email', '${pending.id}', '${A.businessId}', '${pending.id}:paid-v1', 'queued')`);
    const sender = fakeSender();
    await runPaidEmailJobs(service, sender);
    expect(sender.sent.some((message) => message.to === pending.email)).toBe(false);
    expect(job(pending.id)).toBe("retryable_failed|1|PAYMENT_NOT_APPLIED|false");
  });

  it("dua worker bersamaan hanya mengirim satu email per pesanan", async () => {
    const paid = await order({ pay: true });
    const sender = fakeSender();
    await Promise.all([runPaidEmailJobs(service, sender), runPaidEmailJobs(service, sender), runPaidEmailJobs(service, sender)]);
    expect(sender.sent.filter((message) => message.to === paid.email)).toHaveLength(1);
    expect(job(paid.id)).toBe("succeeded|1|-|true");
  });
});
