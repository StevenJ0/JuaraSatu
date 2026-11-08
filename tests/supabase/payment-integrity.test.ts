// Uji P2-2 terhadap Supabase lokal sungguhan: settlement yang tertahan kunci (R1/A6-09) dan urutan kunci
// pembayaran terlambat vs settlement (R2/U01). Sesi lain dibuat lewat psql terpisah dengan jeda terkontrol.
import { spawn } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { publicOrderSchema } from "@/features/orders/schemas";
import { createPrivateOrderToken, placePublicOrder } from "@/features/orders/service";
import { applyVerifiedPayment, claimPaymentAttempt } from "@/features/payments/service";
import { cleanupOwners, container, createOwner, createPublishedPreorder, service, sha256, sleep, sql, type Owner, type PreorderFixture } from "./helpers";

const stamp = Date.now();
const PREFIX = "p22";
let A: Owner;

beforeAll(async () => {
  A = await createOwner(PREFIX, "a", stamp);
});

afterAll(() => {
  cleanupOwners(PREFIX, stamp);
});

/** Satu sesi psql terpisah. `asOwner` menjalankan kueri sebagai pemilik A, seperti panggilan dari dashboard. */
function session(query: string, asOwner = false): Promise<{ code: number | null; stderr: string }> {
  const claims = asOwner ? `set local role authenticated;
    select set_config('request.jwt.claims', '{"sub":"${A.userId}","role":"authenticated"}', true);` : "";
  const child = spawn("docker", ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q"], { stdio: ["pipe", "ignore", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
  child.stdin.end(`begin; ${claims} ${query} commit;`);
  return new Promise((done) => child.on("close", (code) => done({ code, stderr })));
}

let count = 0;
async function order(target: PreorderFixture, quantity: number, ttlSeconds: number) {
  count += 1;
  const token = createPrivateOrderToken();
  const input = publicOrderSchema.parse({ slug: target.slug, idempotencyKey: `${PREFIX}-key-${stamp}-${count}-abcdef`, privateToken: token,
    customerName: "Pembeli", customerEmail: `${PREFIX}-buyer-${count}@example.com`, customerContact: "", quantity, expectedUnitPriceIdr: 120000 });
  const outcome = await placePublicOrder(service, input, ttlSeconds);
  if (outcome.kind !== "ok") throw new Error(`order: ${outcome.violation}`);
  const claimed = await claimPaymentAttempt(service, token);
  if (claimed.kind !== "ok") throw new Error(`claim: ${claimed.violation}`);
  return { id: outcome.value.orderId, attempt: claimed.value, amount: quantity * 120000 };
}

/** Settlement terverifikasi dari adapter. Galat database dicatat sebagai hasil, bukan dilempar, agar bisa diperiksa. */
async function settle(placed: Awaited<ReturnType<typeof order>>) {
  count += 1;
  try {
    const outcome = await applyVerifiedPayment(service, { providerOrderId: placed.attempt.providerOrderId, providerEventKey: `${PREFIX}-evt-${stamp}-${count}`,
      payloadHash: sha256(`${PREFIX}-${count}`), providerStatus: "settlement", providerTransactionId: null, amountIdr: placed.amount, providerPaidAt: new Date().toISOString() });
    return outcome.kind === "ok" ? outcome.value.outcome : `rejected:${outcome.violation}`;
  } catch (error) {
    return `error:${error instanceof Error ? error.message : String(error)}`;
  }
}

const state = (orderId: string) => sql(`select o.order_status || '|' || coalesce(r.state, '-') || '|' || (p.applied_at is not null) || '|' ||
  (select count(*) from public.job_runs where job_type = 'send_paid_email' and entity_id = o.id)
  from public.orders o left join public.capacity_reservations r on r.order_id = o.id join public.payments p on p.order_id = o.id where o.id = '${orderId}'`);
const committed = (capacityId: string) => Number(sql(`select coalesce(sum(quantity), 0) from public.capacity_reservations
  where capacity_id = '${capacityId}' and (state = 'allocated' or (state = 'held' and expires_at > clock_timestamp()))`));
const version = (orderId: string) => sql(`select version from public.orders where id = '${orderId}'`);

describe("R1: settlement tertahan kunci sampai lewat tenggat hold", () => {
  it("hold yang sudah lewat saat settlement benar-benar diproses masuk tinjauan, bukan dialokasikan", async () => {
    const target = createPublishedPreorder(A, PREFIX, stamp, { quota: 2, capacity: 2 });
    const placed = await order(target, 2, 2);
    // Transaksi lain (misalnya perintah pemilik) memegang kunci pesanan melewati tenggat hold 2 detik.
    const holder = session(`select 1 from public.orders where id = '${placed.id}' for update; select pg_sleep(3.5);`);
    await sleep(300);
    const outcome = await settle(placed);
    expect((await holder).code).toBe(0);
    expect(outcome).toBe("review");
    expect(state(placed.id)).toBe("requires_review|released|false|0");
  });

  it("slot yang sudah diambil pembeli lain setelah tenggat tidak membuat settlement gagal atau overbooking", async () => {
    const target = createPublishedPreorder(A, PREFIX, stamp, { quota: 2, capacity: 2 });
    const late = await order(target, 2, 2);
    const holder = session(`select 1 from public.orders where id = '${late.id}' for update; select pg_sleep(4.5);`);
    await sleep(300);
    const settling = settle(late);
    await sleep(2500);
    const other = await order(target, 2, 900);
    const outcome = await settling;
    expect((await holder).code).toBe(0);
    expect(outcome).toBe("review");
    expect(state(late.id)).toBe("requires_review|released|false|0");
    expect(state(other.id)).toBe("pending_payment|held|false|0");
    expect(committed(target.capacityId)).toBe(2);
  });

  it("kontrol: settlement sebelum tenggat tanpa tertahan tetap dialokasikan sekali dengan satu email", async () => {
    const target = createPublishedPreorder(A, PREFIX, stamp, { quota: 2, capacity: 2 });
    const placed = await order(target, 2, 900);
    expect(await settle(placed)).toBe("applied");
    expect(state(placed.id)).toBe("awaiting_confirmation|allocated|true|1");
  });
});

describe("R2: terima pembayaran terlambat vs settlement", () => {
  it("status tidak sah: terima pada pesanan yang settlement-nya sedang melepas hold kedaluwarsa tidak deadlock", async () => {
    const target = createPublishedPreorder(A, PREFIX, stamp, { quota: 2, capacity: 2 });
    const placed = await order(target, 2, 1);
    await sleep(1500);
    // Pemilik menekan terima: kunci pertama accept_late_payment (pesanan) dipegang dulu, lalu fungsi asli dijalankan setelah jeda.
    const accepting = session(`select 1 from public.orders where id = '${placed.id}' for update; select pg_sleep(1.5);
      set local role authenticated;
      select set_config('request.jwt.claims', '{"sub":"${A.userId}","role":"authenticated"}', true);
      select public.accept_late_payment('${placed.id}', ${version(placed.id)}, '${placed.attempt.paymentId}');`);
    await sleep(300);
    const outcome = await settle(placed);
    const accepted = await accepting;
    expect(`${outcome} ${accepted.stderr}`).not.toContain("deadlock");
    expect(outcome).toBe("review");
    expect(accepted.stderr).toContain("ORDER_STATE_INVALID");
    expect(state(placed.id)).toBe("requires_review|released|false|0");
  });

  it("status sah: terima pesanan A bersamaan dengan settlement pesanan B pada kapasitas yang sama tidak deadlock dan tidak overbooking", async () => {
    const target = createPublishedPreorder(A, PREFIX, stamp, { quota: 4, capacity: 4 });
    const late = await order(target, 2, 1);
    await sleep(1500);
    expect(await settle(late)).toBe("review");
    const fresh = await order(target, 2, 900);
    const accepting = session(`select 1 from public.orders where id = '${late.id}' for update; select pg_sleep(1.5);
      set local role authenticated;
      select set_config('request.jwt.claims', '{"sub":"${A.userId}","role":"authenticated"}', true);
      select public.accept_late_payment('${late.id}', ${version(late.id)}, '${late.attempt.paymentId}');`);
    await sleep(300);
    const outcome = await settle(fresh);
    const accepted = await accepting;
    expect(`${outcome} ${accepted.stderr}`).not.toContain("deadlock");
    expect(accepted.code).toBe(0);
    expect(outcome).toBe("applied");
    expect(state(late.id)).toBe("awaiting_confirmation|allocated|true|1");
    expect(state(fresh.id)).toBe("awaiting_confirmation|allocated|true|1");
    expect(committed(target.capacityId)).toBe(4);
  });

  it("kedaluwarsa pesanan bersamaan dengan settlement pesanan yang sama tidak deadlock", async () => {
    const target = createPublishedPreorder(A, PREFIX, stamp, { quota: 2, capacity: 2 });
    const placed = await order(target, 2, 1);
    await sleep(1500);
    // Pemilik atau job merapikan pesanan: kunci pesanan lebih dulu (urutan expire_or_cancel_order), lalu fungsi asli setelah jeda.
    const expiring = session(`select 1 from public.orders where id = '${placed.id}' for update; select pg_sleep(1.5);
      set local role authenticated;
      select set_config('request.jwt.claims', '{"sub":"${A.userId}","role":"authenticated"}', true);
      select public.expire_or_cancel_order('${placed.id}', ${version(placed.id)}, 'expire', null, null);`);
    await sleep(300);
    const outcome = await settle(placed);
    const expired = await expiring;
    expect(`${outcome} ${expired.stderr}`).not.toContain("deadlock");
    expect(expired.code).toBe(0);
    expect(outcome).toBe("review");
    expect(state(placed.id)).toMatch(/^requires_review|released|false|0$/);
  });
});
