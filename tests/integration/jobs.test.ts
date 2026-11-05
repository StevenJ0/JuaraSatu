// Antrean job: pengambilan atomik, sewa, ulang terbatas, dan perapian pesanan kedaluwarsa. PRD §12.6 dan TC-47.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { claimJobs, completeJob, enqueueExpireJobs, failJob, type ClaimedJob } from "@/features/jobs/repository";
import { runExpireJobs } from "@/features/jobs/service";
import { publicOrderSchema } from "@/features/orders/schemas";
import { createPrivateOrderToken, placePublicOrder } from "@/features/orders/service";
import { applyVerifiedPayment, claimPaymentAttempt } from "@/features/payments/service";
import { anon, cleanupOwners, createOwner, createPublishedPreorder, service, sleep, sql, type Owner, type PreorderFixture } from "./helpers";

const stamp = Date.now();
const PREFIX = "job";
let A: Owner;

beforeAll(async () => {
  A = await createOwner(PREFIX, "a", stamp);
});

afterAll(() => {
  cleanupOwners(PREFIX, stamp);
});

let count = 0;
function queueEmailJob(): string {
  count += 1;
  return sql(`insert into public.job_runs (job_type, entity_id, business_id, dedupe_key) values ('send_paid_email', gen_random_uuid(), '${A.businessId}', 'job-${stamp}-${count}') returning id`);
}
const jobRow = (id: string) => sql(`select status || '|' || attempt_count from public.job_runs where id = '${id}'`);
const orderStatus = (id: string) => sql(`select order_status from public.orders where id = '${id}'`);
/** Trigger tidak ada di job_runs, jadi waktunya bisa dimundurkan langsung untuk meniru waktu yang berlalu. */
const expireLease = (id: string) => sql(`update public.job_runs set locked_until = now() - interval '1 second' where id = '${id}'`);
const makeReady = (id: string) => sql(`update public.job_runs set next_run_at = now() - interval '1 second' where id = '${id}'`);
/** Pekerjaan lain di antrean tidak boleh mengganggu uji, jadi hasil selalu disaring ke job uji ini. */
const ownJob = (jobs: ClaimedJob[], id: string) => jobs.find((job) => job.id === id);

async function order(target: PreorderFixture, ttl: number) {
  count += 1;
  const token = createPrivateOrderToken();
  const outcome = await placePublicOrder(service, publicOrderSchema.parse({ slug: target.slug, idempotencyKey: `job-key-${stamp}-${count}-abcdef`, privateToken: token, customerName: "P", customerEmail: `job-buyer-${count}@example.com`, customerContact: "", quantity: 1, expectedUnitPriceIdr: 120000 }), ttl);
  if (outcome.kind !== "ok") throw new Error(`order: ${outcome.violation}`);
  return { id: outcome.value.orderId, token };
}

describe("claim_jobs", () => {
  it("pengambilan bersamaan: satu job hanya dipegang satu worker", async () => {
    const id = queueEmailJob();
    const claims = await Promise.all(Array.from({ length: 8 }, () => claimJobs(service, ["send_paid_email"], 100, 60)));
    expect(claims.filter((jobs) => ownJob(jobs, id)).length).toBe(1);
    expect(jobRow(id)).toBe("running|1");
    for (const jobs of claims) for (const job of jobs) await completeJob(service, job);
  });

  it("hanya mengambil jenis yang diminta dan yang sudah waktunya", async () => {
    const id = queueEmailJob();
    expect(ownJob(await claimJobs(service, ["reconcile"], 100, 60), id)).toBeUndefined();
    sql(`update public.job_runs set next_run_at = now() + interval '1 hour' where id = '${id}'`);
    expect(ownJob(await claimJobs(service, ["send_paid_email"], 100, 60), id)).toBeUndefined();
    makeReady(id);
    const claimed = ownJob(await claimJobs(service, ["send_paid_email"], 100, 60), id);
    expect(claimed).toMatchObject({ type: "send_paid_email", attempt: 1, businessId: A.businessId });
    if (claimed) await completeJob(service, claimed);
  });

  it("sewa lewat: job bisa diambil lagi, dan worker lama tidak bisa menyelesaikannya", async () => {
    const id = queueEmailJob();
    const first = ownJob(await claimJobs(service, ["send_paid_email"], 100, 60), id);
    if (!first) throw new Error("claim");
    expect(ownJob(await claimJobs(service, ["send_paid_email"], 100, 60), id)).toBeUndefined();

    expireLease(id);
    const second = ownJob(await claimJobs(service, ["send_paid_email"], 100, 60), id);
    expect(second).toMatchObject({ attempt: 2 });
    if (!second) throw new Error("claim");

    expect(await completeJob(service, first)).toBe(false);
    expect(await failJob(service, first, "TERLAMBAT")).toBeNull();
    expect(jobRow(id)).toBe("running|2");
    expect(await completeJob(service, second, "provider-123")).toBe(true);
    expect(sql(`select status || '|' || provider_reference || '|' || (finished_at is not null) from public.job_runs where id = '${id}'`)).toBe("succeeded|provider-123|true");
  });

  it("selesai tidak bisa diambil lagi", async () => {
    const id = queueEmailJob();
    const claimed = ownJob(await claimJobs(service, ["send_paid_email"], 100, 60), id);
    if (!claimed) throw new Error("claim");
    await completeJob(service, claimed);
    expect(ownJob(await claimJobs(service, ["send_paid_email"], 100, 60), id)).toBeUndefined();
    expect(await completeJob(service, claimed)).toBe(false);
  });

  it("gagal: mundur 1, 5, 15, 60 menit, lalu berhenti di percobaan ke-5", async () => {
    const id = queueEmailJob();
    const delays = [1, 5, 15, 60];
    for (const minutes of delays) {
      const job = ownJob(await claimJobs(service, ["send_paid_email"], 100, 60), id);
      if (!job) throw new Error("claim");
      expect(await failJob(service, job, "PROVIDER_ERROR")).toBe("retryable_failed");
      const seconds = Number(sql(`select extract(epoch from next_run_at - now()) from public.job_runs where id = '${id}'`));
      expect(seconds).toBeGreaterThan(minutes * 60 - 30);
      expect(seconds).toBeLessThanOrEqual(minutes * 60);
      expect(ownJob(await claimJobs(service, ["send_paid_email"], 100, 60), id)).toBeUndefined();
      makeReady(id);
    }
    const last = ownJob(await claimJobs(service, ["send_paid_email"], 100, 60), id);
    if (!last) throw new Error("claim");
    expect(last.attempt).toBe(5);
    expect(await failJob(service, last, "PROVIDER_ERROR")).toBe("dead");
    expect(jobRow(id)).toBe("dead|5");
    expect(ownJob(await claimJobs(service, ["send_paid_email"], 100, 60), id)).toBeUndefined();
    expect(sql(`select last_error_code from public.job_runs where id = '${id}'`)).toBe("PROVIDER_ERROR");
  });

  it("worker mati berkali-kali: berhenti juga di percobaan ke-5", async () => {
    const id = queueEmailJob();
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      expect(ownJob(await claimJobs(service, ["send_paid_email"], 100, 60), id)?.attempt).toBe(attempt);
      expireLease(id);
    }
    expect(ownJob(await claimJobs(service, ["send_paid_email"], 100, 60), id)).toBeUndefined();
    expect(sql(`select status || '|' || last_error_code from public.job_runs where id = '${id}'`)).toBe("dead|LEASE_EXPIRED");
  });

  it("kode error hanya huruf besar, jadi data pelanggan tidak bisa masuk", async () => {
    const id = queueEmailJob();
    const job = ownJob(await claimJobs(service, ["send_paid_email"], 100, 60), id);
    if (!job) throw new Error("claim");
    for (const code of ["budi@example.com", "gagal kirim", "", "x".repeat(65)]) await expect(failJob(service, job, code)).rejects.toThrow();
    await completeJob(service, job);
  });

  it.each([
    [[], 10, 60],
    [["send_paid_email"], 0, 60],
    [["send_paid_email"], 101, 60],
    [["send_paid_email"], 10, 0],
    [["send_paid_email"], 10, 3601],
  ])("batas masukan ditolak: %j", async (types, limit, lease) => {
    const { error } = await service.rpc("claim_jobs", { p_job_types: types, p_limit: limit, p_lease_seconds: lease });
    expect(error?.message).toContain("VALIDATION_ERROR");
  });

  it("pemilik dan tamu tidak punya akses", async () => {
    const id = queueEmailJob();
    for (const client of [A.client, anon]) {
      expect((await client.rpc("claim_jobs", { p_job_types: ["send_paid_email"], p_limit: 1, p_lease_seconds: 60 })).error).not.toBeNull();
      expect((await client.rpc("complete_job", { p_job_id: id, p_attempt: 1 })).error).not.toBeNull();
      expect((await client.rpc("fail_job", { p_job_id: id, p_attempt: 1, p_error_code: "X" })).error).not.toBeNull();
      expect((await client.rpc("enqueue_expire_jobs", { p_limit: 1 })).error).not.toBeNull();
      expect((await client.from("job_runs").select("id")).error).not.toBeNull();
    }
    expect(jobRow(id)).toBe("queued|0");
    sql(`update public.job_runs set status = 'succeeded' where id = '${id}'`);
  });
});

describe("runExpireJobs", () => {
  it("merapikan yang lewat tenggat, tidak menyentuh yang belum, dan aman diulang", async () => {
    const target = createPublishedPreorder(A, PREFIX, stamp);
    const overdue = await order(target, 1);
    const stillOpen = await order(target, 900);
    await sleep(1400);

    const summary = await runExpireJobs(service, 100);
    expect(summary.expired).toBeGreaterThanOrEqual(1);
    expect(orderStatus(overdue.id)).toBe("expired");
    expect(orderStatus(stillOpen.id)).toBe("pending_payment");
    expect(sql(`select state from public.capacity_reservations where order_id = '${overdue.id}'`)).toBe("released");

    await runExpireJobs(service, 100);
    expect(sql(`select count(*) from public.job_runs where entity_id = '${overdue.id}' and job_type = 'expire'`)).toBe("1");
    expect(sql(`select count(*) from public.order_events where order_id = '${overdue.id}' and event_type = 'order_expired'`)).toBe("1");
  });

  it("lunas sesudah masuk antrean: job selesai tanpa mengubah pesanan", async () => {
    const target = createPublishedPreorder(A, PREFIX, stamp);
    const placed = await order(target, 900);
    const claim = await claimPaymentAttempt(service, placed.token);
    if (claim.kind !== "ok") throw new Error("claim");
    await applyVerifiedPayment(service, { providerOrderId: claim.value.providerOrderId, providerEventKey: `evt-${placed.id}`, payloadHash: "h", providerStatus: "settlement", providerTransactionId: null, amountIdr: 120000, providerPaidAt: null });
    sql(`insert into public.job_runs (job_type, entity_id, business_id, dedupe_key) values ('expire', '${placed.id}', '${A.businessId}', 'expire:${placed.id}')`);

    await runExpireJobs(service, 100);

    expect(orderStatus(placed.id)).toBe("awaiting_confirmation");
    expect(sql(`select status from public.job_runs where dedupe_key = 'expire:${placed.id}'`)).toBe("succeeded");
  });

  it("dua scheduler bersamaan: satu pesanan dirapikan sekali", async () => {
    const target = createPublishedPreorder(A, PREFIX, stamp);
    const overdue = await order(target, 1);
    await sleep(1400);
    await Promise.all([runExpireJobs(service, 100), runExpireJobs(service, 100), runExpireJobs(service, 100)]);
    expect(orderStatus(overdue.id)).toBe("expired");
    expect(sql(`select count(*) from public.order_events where order_id = '${overdue.id}' and event_type = 'order_expired'`)).toBe("1");
  });

  it("enqueue mengembalikan jumlah yang baru masuk saja", async () => {
    const target = createPublishedPreorder(A, PREFIX, stamp);
    await order(target, 1);
    await sleep(1400);
    expect(await enqueueExpireJobs(service, 1000)).toBeGreaterThanOrEqual(1);
    expect(await enqueueExpireJobs(service, 1000)).toBe(0);
    await runExpireJobs(service, 100);
  });
});
