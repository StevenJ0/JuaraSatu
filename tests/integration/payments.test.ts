// Uji colokan harga dan pembayaran terhadap Supabase lokal sungguhan. Fakta pembayaran buatan menggantikan Midtrans. Data uji dibersihkan. Nilai key tidak dicetak.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { findOrder } from "@/features/orders/repository";
import { publicOrderSchema } from "@/features/orders/schemas";
import { acceptLatePayment, cancelOrder, createManualOrder, createPrivateOrderToken, declineLatePayment, expireOrder, findOrderByPrivateToken, placePublicOrder, runOrderAction } from "@/features/orders/service";
import { listOrderPayments } from "@/features/payments/repository";
import { applyVerifiedPayment, claimPaymentAttempt, recordPaymentCharge } from "@/features/payments/service";
import { findPreorder, findPublicPreorder } from "@/features/preorders/repository";
import { anon, anonKey, service, sql, url } from "./helpers";

const options = { auth: { persistSession: false, autoRefreshToken: false } };
const stamp = Date.now();
const password = "PayCheck-Lokal-12345";
const STUB_OFFER = "create or replace function private.current_order_offer(p_preorder_id uuid) returns table (discount_bps integer, pricing_campaign_id uuid) language sql stable security definer set search_path = '' as $$ select 0, null::uuid; $$;";
const setOffer = (bps: number, campaignId: string | null) =>
  sql(`create or replace function private.current_order_offer(p_preorder_id uuid) returns table (discount_bps integer, pricing_campaign_id uuid) language sql stable security definer set search_path = '' as $$ select ${bps}, ${campaignId ? `'${campaignId}'::uuid` : "null::uuid"}; $$;`);

type Owner = { businessId: string; productId: string; client: SupabaseClient };

async function owner(label: string): Promise<Owner> {
  const email = `pay-check-${label}-${stamp}@example.com`;
  const { data, error } = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw new Error(`createUser: ${error?.message}`);
  const businessId = sql(`insert into public.businesses (name, slug, categories, pickup_instructions) values ('Usaha ${label}', 'pay-${label}-${stamp}', array['Fashion'], 'Ambil') returning id`);
  sql(`insert into public.business_members (business_id, user_id) values ('${businessId}', '${data.user.id}')`);
  const productId = sql(`insert into public.products (business_id, name, sku, base_price_idr, variable_cost_idr, cost_quality) values ('${businessId}', 'Kaos', 'PAY${stamp}${label}', 120000, 75000, 'estimated') returning id`);
  const client = createClient(url, anonKey, options);
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`signIn: ${signInError.message}`);
  return { businessId, productId, client };
}

let day = 300;
let slugCount = 0;
function preorder(who: Owner, { capacity = 40, quota = 40, price = 120000 } = {}) {
  day += 1;
  slugCount += 1;
  const date = new Date(Date.now() + day * 86400e3).toISOString().slice(0, 10);
  const capacityId = sql(`insert into public.production_capacity (business_id, product_id, fulfillment_date, total_units, intake_cutoff_at, fulfillment_window_end_at) values ('${who.businessId}', '${who.productId}', '${date}', ${capacity}, now() + interval '6 days', '${date} 17:00+07') returning id`);
  const slug = `pay-${stamp}-${slugCount}`;
  const id = sql(`insert into public.preorders (business_id, name, slug, status, fulfillment_date, starts_at, ends_at, pickup_terms_snapshot) values ('${who.businessId}', 'Preorder', '${slug}', 'published', '${date}', now() - interval '1 day', now() + interval '5 days', jsonb_build_object('pickup_instructions', 'Ambil', 'public_contact', null, 'intake_cutoff_at', now() + interval '6 days', 'fulfillment_window_end_at', '${date} 17:00+07'::timestamptz)) returning id`);
  sql(`insert into public.preorder_items (business_id, preorder_id, product_id, capacity_id, target_units, quota_units, base_price_snapshot_idr, product_name_snapshot, sku_snapshot) values ('${who.businessId}', '${id}', '${who.productId}', '${capacityId}', ${Math.min(quota, 10)}, ${quota}, ${price}, 'Kaos', 'PAY')`);
  return { id, slug, capacityId, who };
}

let orderCount = 0;
async function order(target: { slug: string }, { quantity = 2, ttl = 900, expected = 120000 } = {}) {
  orderCount += 1;
  const token = createPrivateOrderToken();
  const input = publicOrderSchema.parse({ slug: target.slug, idempotencyKey: `pay-key-${stamp}-${orderCount}-abcdef`, privateToken: token, customerName: "Pembeli", customerEmail: `pay-buyer-${stamp}-${orderCount}@example.com`, customerContact: "", quantity, expectedUnitPriceIdr: expected });
  const outcome = await placePublicOrder(service, input, ttl);
  if (outcome.kind !== "ok") throw new Error(`order: ${outcome.violation}`);
  return { token, id: outcome.value.orderId, total: outcome.value.totalIdr };
}

const claim = async (token: string) => {
  const outcome = await claimPaymentAttempt(service, token);
  if (outcome.kind !== "ok") throw new Error(`claim: ${outcome.violation}`);
  return outcome.value;
};
let eventCount = 0;
const fact = (providerOrderId: string, status: string, amountIdr: number, key?: string) => {
  eventCount += 1;
  return { providerOrderId, providerEventKey: key ?? `evt-${stamp}-${eventCount}`, payloadHash: `hash-${eventCount}`, providerStatus: status, providerTransactionId: null, amountIdr, providerPaidAt: status === "settlement" ? new Date().toISOString() : null };
};
const apply = async (factValue: ReturnType<typeof fact>) => {
  const outcome = await applyVerifiedPayment(service, factValue);
  if (outcome.kind !== "ok") throw new Error(`apply: ${outcome.violation}`);
  return outcome.value;
};
const orderRow = (id: string) => sql(`select order_status || '|' || fulfillment_status from public.orders where id = '${id}'`);
const reservationState = (id: string) => sql(`select state from public.capacity_reservations where order_id = '${id}'`);
const emailJobs = (id: string) => Number(sql(`select count(*) from public.job_runs where job_type = 'send_paid_email' and entity_id = '${id}'`));
const paymentRow = (id: string) => sql(`select status || '|' || (applied_at is not null) || '|' || is_active_attempt from public.payments where id = '${id}'`);
const eventCountOf = (id: string) => Number(sql(`select count(*) from public.payment_events where payment_id = '${id}'`));
const version = (id: string) => Number(sql(`select version from public.orders where id = '${id}'`));
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let A: Owner;
let B: Owner;

beforeAll(async () => {
  A = await owner("a");
  B = await owner("b");
});

afterAll(() => {
  sql(STUB_OFFER);
  sql(`begin;
    create temp table doomed on commit drop as select id from public.businesses where slug like 'pay-%-${stamp}';
    set local session_replication_role = replica;
    delete from public.job_runs where business_id in (select id from doomed);
    delete from public.payment_events where business_id in (select id from doomed);
    delete from public.payments where business_id in (select id from doomed);
    delete from public.order_production_costs where business_id in (select id from doomed);
    delete from public.capacity_reservations where business_id in (select id from doomed);
    delete from public.order_events where business_id in (select id from doomed);
    delete from public.order_items where business_id in (select id from doomed);
    delete from public.orders where business_id in (select id from doomed);
    delete from public.preorder_items where business_id in (select id from doomed);
    delete from public.preorders where business_id in (select id from doomed);
    delete from public.production_capacity where business_id in (select id from doomed);
    delete from public.products where business_id in (select id from doomed);
    delete from public.business_members where business_id in (select id from doomed);
    delete from public.businesses where id in (select id from doomed);
    delete from auth.users where email like 'pay-check-%-${stamp}@example.com';
    commit;`);
});

describe("colokan harga", () => {
  afterEach(() => sql(STUB_OFFER));

  it("tanpa kampanye: diskon 0, harga dasar", async () => {
    const target = preorder(A);
    expect(await findPublicPreorder(service, target.slug)).toMatchObject({ unitPriceIdr: 120000, basePriceIdr: 120000, discountBps: 0 });
    const placed = await order(target);
    expect(placed.total).toBe(240000);
  });

  it("contoh kontrak C2: 120.000 diskon 1.000 bps, 2 unit", async () => {
    const target = preorder(A);
    const campaign = "99999999-9999-4999-8999-999999999999";
    setOffer(1000, campaign);

    expect(await findPublicPreorder(service, target.slug)).toMatchObject({ unitPriceIdr: 108000, basePriceIdr: 120000, discountBps: 1000 });
    const placed = await order(target, { expected: 108000 });

    expect(placed.total).toBe(216000);
    expect(sql(`select subtotal_idr || '|' || discount_total_idr || '|' || total_idr || '|' || pricing_campaign_id from public.orders where id = '${placed.id}'`)).toBe(`240000|24000|216000|${campaign}`);
    expect(sql(`select discount_bps_snapshot || '|' || discount_per_unit_idr || '|' || final_unit_price_idr || '|' || line_total_idr || '|' || pricing_campaign_id from public.order_items where order_id = '${placed.id}'`)).toBe(`1000|12000|108000|216000|${campaign}`);
    expect(await findOrderByPrivateToken(service, placed.token)).toMatchObject({ baseUnitPriceIdr: 120000, discountPerUnitIdr: 12000, finalUnitPriceIdr: 108000, totalIdr: 216000 });
  });

  it("contoh pembulatan PRD: 101 diskon 500 bps menjadi 96, 3 unit 288", async () => {
    const target = preorder(A, { price: 101 });
    setOffer(500, null);
    const placed = await order(target, { quantity: 3, expected: 96 });
    expect(placed.total).toBe(288);
  });

  it("harga yang dilihat sudah berubah: OFFER_CHANGED", async () => {
    const target = preorder(A);
    setOffer(1000, null);
    const input = publicOrderSchema.parse({ slug: target.slug, idempotencyKey: `pay-stale-${stamp}-abcdefgh`, privateToken: createPrivateOrderToken(), customerName: "Pembeli", customerEmail: "pay-stale@example.com", customerContact: "", quantity: 1, expectedUnitPriceIdr: 120000 });
    expect(await placePublicOrder(service, input, 900)).toEqual({ kind: "rejected", violation: "OFFER_CHANGED" });
  });

  it("pesanan lama tidak berubah saat diskon berubah", async () => {
    const target = preorder(A);
    const placed = await order(target);
    setOffer(5000, null);
    expect(sql(`select total_idr from public.orders where id = '${placed.id}'`)).toBe("240000");
    expect((await findOrderByPrivateToken(service, placed.token))?.totalIdr).toBe(240000);
  });

  it("pesanan manual tetap harga dasar walau ada diskon", async () => {
    const target = preorder(A);
    setOffer(1000, null);
    const outcome = await createManualOrder(A.client, { preorderId: target.id, idempotencyKey: crypto.randomUUID(), customerName: "Manual", customerEmail: null, customerContact: null, quantity: 1, paymentStatus: "paid" });
    expect(outcome).toMatchObject({ kind: "ok", value: { totalIdr: 120000 } });
  });

  it("fungsi penawaran hanya untuk server", async () => {
    const target = preorder(A);
    expect((await anon.rpc("read_preorder_offer", { p_preorder_id: target.id })).error).not.toBeNull();
    expect((await A.client.rpc("read_preorder_offer", { p_preorder_id: target.id })).error).not.toBeNull();
  });
});

describe("percobaan bayar", () => {
  // updated_at diisi trigger, jadi trigger dimatikan sementara untuk meniru penagih yang berhenti di tengah jalan.
  const ageAttempt = (paymentId: string) =>
    sql(`begin; set local session_replication_role = replica; update public.payments set updated_at = now() - interval '2 minutes' where id = '${paymentId}'; commit;`);

  it("klik kedua tidak mendapat izin menagih, nominal dari server", async () => {
    const placed = await order(preorder(A));
    const first = await claim(placed.token);
    const second = await claim(placed.token);
    expect(first).toMatchObject({ action: "create_charge", status: "initiating", amountIdr: 240000, attemptNumber: 1 });
    expect(second).toMatchObject({ action: "wait", paymentId: first.paymentId, providerOrderId: first.providerOrderId });
  });

  it("6 tab bersamaan: satu percobaan dan tepat satu izin menagih", async () => {
    const placed = await order(preorder(A));
    const attempts = await Promise.all(Array.from({ length: 6 }, () => claim(placed.token)));
    expect(new Set(attempts.map((attempt) => attempt.paymentId)).size).toBe(1);
    expect(attempts.filter((attempt) => attempt.action === "create_charge").length).toBe(1);
    expect(attempts.filter((attempt) => attempt.action === "wait").length).toBe(5);
    expect(sql(`select count(*) from public.payments where order_id = '${placed.id}'`)).toBe("1");
  });

  it("penagih berhenti di tengah jalan: satu pemanggil mendapat reconcile dengan referensi yang sama", async () => {
    const placed = await order(preorder(A));
    const first = await claim(placed.token);
    ageAttempt(first.paymentId);

    const attempts = await Promise.all(Array.from({ length: 5 }, () => claim(placed.token)));

    expect(attempts.filter((attempt) => attempt.action === "reconcile").length).toBe(1);
    expect(attempts.filter((attempt) => attempt.action === "wait").length).toBe(4);
    expect(attempts.every((attempt) => attempt.providerOrderId === first.providerOrderId)).toBe(true);
    expect(attempts.some((attempt) => attempt.action === "create_charge")).toBe(false);
    expect(sql(`select count(*) from public.payments where order_id = '${placed.id}'`)).toBe("1");
  });

  it("webhook pending lebih dulu tanpa QR: tetap tidak ada izin menagih kedua", async () => {
    const placed = await order(preorder(A));
    const first = await claim(placed.token);
    await apply(fact(first.providerOrderId, "pending", 240000));
    expect(await claim(placed.token)).toMatchObject({ action: "wait", status: "pending", qrContent: null });
  });

  it("token salah ditolak", async () => {
    expect(await claimPaymentAttempt(service, createPrivateOrderToken())).toEqual({ kind: "rejected", violation: "ORDER_NOT_FOUND" });
  });

  it("menyimpan QR, dan tidak menimpa setelah lunas", async () => {
    const placed = await order(preorder(A));
    const attempt = await claim(placed.token);
    expect(await recordPaymentCharge(service, { paymentId: attempt.paymentId, providerTransactionId: `txn-${stamp}-1`, qrContent: "qr-awal", qrExpiresAt: new Date(Date.now() + 600e3).toISOString() })).toEqual({ kind: "ok", value: true });
    expect(await claim(placed.token)).toMatchObject({ action: "reuse_qr", status: "pending", qrContent: "qr-awal" });

    await apply(fact(attempt.providerOrderId, "settlement", 240000));
    expect(await recordPaymentCharge(service, { paymentId: attempt.paymentId, providerTransactionId: null, qrContent: "qr-terlambat", qrExpiresAt: null })).toEqual({ kind: "ok", value: false });
    expect(sql(`select qr_content from public.payments where id = '${attempt.paymentId}'`)).toBe("qr-awal");
  });
});

describe("apply_verified_payment", () => {
  it("settlement: tepat sekali dalam satu transaksi", async () => {
    const target = preorder(A);
    const placed = await order(target);
    const attempt = await claim(placed.token);
    const before = (await findPublicPreorder(service, target.slug))?.orderableUnits;

    expect(await apply(fact(attempt.providerOrderId, "settlement", 240000))).toMatchObject({ outcome: "applied", orderStatus: "awaiting_confirmation" });

    expect(orderRow(placed.id)).toBe("awaiting_confirmation|pending_confirmation");
    expect(reservationState(placed.id)).toBe("allocated");
    expect(paymentRow(attempt.paymentId)).toBe("paid_sandbox|true|false");
    expect(emailJobs(placed.id)).toBe(1);
    expect(sql(`select dedupe_key from public.job_runs where entity_id = '${placed.id}'`)).toBe(`${placed.id}:paid-v1`);
    expect(sql(`select count(*) from public.order_events where order_id = '${placed.id}' and event_type = 'payment_applied'`)).toBe("1");
    expect((await findPublicPreorder(service, target.slug))?.orderableUnits).toBe(before);
    const buyerView = await findOrderByPrivateToken(service, placed.token);
    expect(buyerView).toMatchObject({ paymentState: "applied", canContinuePayment: false, sku: "PAY" });
    expect(Date.parse(buyerView?.paymentVerifiedAt ?? "")).not.toBeNaN();
    expect((await findPreorder(A.client, A.businessId, target.id))?.metrics.paidUnits).toBe(2);
  });

  it("kunci sama, hash berbeda, fakta sama: duplikat dengan tanda, tanpa efek tambahan", async () => {
    const placed = await order(preorder(A));
    const attempt = await claim(placed.token);
    const event = fact(attempt.providerOrderId, "settlement", 240000);
    await apply(event);

    const result = await apply({ ...event, payloadHash: "hash-format-baru" });

    expect(result).toMatchObject({ outcome: "duplicate", payloadChanged: true });
    expect(eventCountOf(attempt.paymentId)).toBe(1);
    expect(emailJobs(placed.id)).toBe(1);
  });

  it("kunci sama, hash sama: duplikat tanpa tanda", async () => {
    const placed = await order(preorder(A));
    const attempt = await claim(placed.token);
    const event = fact(attempt.providerOrderId, "settlement", 240000);
    await apply(event);
    expect(await apply(event)).toMatchObject({ outcome: "duplicate", payloadChanged: false });
  });

  it("kunci sama, status atau nominal berbeda: konflik, tidak ada yang berubah", async () => {
    const placed = await order(preorder(A));
    const attempt = await claim(placed.token);
    const event = fact(attempt.providerOrderId, "pending", 240000);
    await apply(event);

    expect((await apply({ ...event, providerStatus: "settlement" })).outcome).toBe("conflict");
    expect((await apply({ ...event, amountIdr: 1000 })).outcome).toBe("conflict");

    expect(orderRow(placed.id)).toBe("pending_payment|pending_confirmation");
    expect(reservationState(placed.id)).toBe("held");
    expect(emailJobs(placed.id)).toBe(0);
    expect(eventCountOf(attempt.paymentId)).toBe(1);
  });

  it("event sama diulang 3x: satu efek", async () => {
    const placed = await order(preorder(A));
    const attempt = await claim(placed.token);
    const event = fact(attempt.providerOrderId, "settlement", 240000);
    expect((await apply(event)).outcome).toBe("applied");
    for (let index = 0; index < 3; index += 1) expect((await apply(event)).outcome).toBe("duplicate");
    expect(eventCountOf(attempt.paymentId)).toBe(1);
    expect(emailJobs(placed.id)).toBe(1);
  });

  it("event sama bersamaan: tepat satu yang menerapkan", async () => {
    const placed = await order(preorder(A));
    const attempt = await claim(placed.token);
    const event = fact(attempt.providerOrderId, "settlement", 240000);
    const results = await Promise.all(Array.from({ length: 8 }, () => apply(event)));
    expect(results.filter((result) => result.outcome === "applied").length).toBe(1);
    expect(results.filter((result) => result.outcome === "duplicate").length).toBe(7);
    expect(emailJobs(placed.id)).toBe(1);
  });

  it("settlement dengan kunci event lain tidak menerapkan dua kali", async () => {
    const placed = await order(preorder(A));
    const attempt = await claim(placed.token);
    await apply(fact(attempt.providerOrderId, "settlement", 240000));
    expect((await apply(fact(attempt.providerOrderId, "settlement", 240000))).outcome).toBe("ignored");
    expect(emailJobs(placed.id)).toBe(1);
  });

  it.each(["pending", "expire", "cancel", "deny", "failure"])("%s setelah lunas tidak menurunkan status", async (status) => {
    const placed = await order(preorder(A));
    const attempt = await claim(placed.token);
    await apply(fact(attempt.providerOrderId, "settlement", 240000));
    await apply(fact(attempt.providerOrderId, status, 240000));
    expect(paymentRow(attempt.paymentId)).toBe("paid_sandbox|true|false");
    expect(orderRow(placed.id)).toBe("awaiting_confirmation|pending_confirmation");
  });

  it("nominal tidak cocok tidak mengubah apa pun, tapi tercatat", async () => {
    const placed = await order(preorder(A));
    const attempt = await claim(placed.token);
    expect((await apply(fact(attempt.providerOrderId, "settlement", 1000))).outcome).toBe("amount_mismatch");
    expect(paymentRow(attempt.paymentId)).toBe("initiating|false|true");
    expect(orderRow(placed.id)).toBe("pending_payment|pending_confirmation");
    expect(reservationState(placed.id)).toBe("held");
    expect(emailJobs(placed.id)).toBe(0);
    expect(eventCountOf(attempt.paymentId)).toBe(1);
  });

  it("status tak dikenal diabaikan, bukan dianggap lunas", async () => {
    const placed = await order(preorder(A));
    const attempt = await claim(placed.token);
    for (const status of ["capture", "paid", "SETTLEMENT", "refund"]) expect((await apply(fact(attempt.providerOrderId, status, 240000))).outcome).toBe("ignored");
    expect(paymentRow(attempt.paymentId)).toBe("initiating|false|true");
    expect(orderRow(placed.id)).toBe("pending_payment|pending_confirmation");
  });

  it("referensi tak dikenal ditolak", async () => {
    expect(await applyVerifiedPayment(service, fact(`tidak-ada-${stamp}`, "settlement", 1))).toEqual({ kind: "rejected", violation: "PAYMENT_NOT_FOUND" });
  });

  it("percobaan gagal: pembeli bisa mencoba lagi dan yang kedua diterapkan", async () => {
    const placed = await order(preorder(A));
    const first = await claim(placed.token);
    expect((await apply(fact(first.providerOrderId, "failure", 240000))).outcome).toBe("recorded");
    const second = await claim(placed.token);
    expect(second).toMatchObject({ attemptNumber: 2, action: "create_charge" });
    expect((await apply(fact(second.providerOrderId, "settlement", 240000))).outcome).toBe("applied");
  });

  it("pembayaran ganda: dua fakta, satu diterapkan, pesanan tetap berjalan", async () => {
    const target = preorder(A);
    const placed = await order(target);
    const first = await claim(placed.token);
    await apply(fact(first.providerOrderId, "expire", 240000));
    const second = await claim(placed.token);
    await apply(fact(second.providerOrderId, "settlement", 240000));

    expect((await apply(fact(first.providerOrderId, "settlement", 240000))).outcome).toBe("review");

    expect(orderRow(placed.id)).toBe("awaiting_confirmation|pending_confirmation");
    expect(reservationState(placed.id)).toBe("allocated");
    expect(emailJobs(placed.id)).toBe(1);
    expect((await findPreorder(A.client, A.businessId, target.id))?.metrics.paidUnits).toBe(2);
    expect(sql(`select count(*) from public.payments where order_id = '${placed.id}' and status = 'paid_sandbox'`)).toBe("2");
    expect(sql(`select count(*) from public.payments where order_id = '${placed.id}' and applied_at is not null`)).toBe("1");
    expect((await findOrder(A.client, A.businessId, placed.id))?.paymentState).toBe("applied");
  });

  it("pesanan yang sudah lunas tidak bisa diklaim lagi", async () => {
    const placed = await order(preorder(A));
    const attempt = await claim(placed.token);
    await apply(fact(attempt.providerOrderId, "settlement", 240000));
    expect(await claimPaymentAttempt(service, placed.token)).toEqual({ kind: "rejected", violation: "ORDER_STATE_INVALID" });
  });

  it("setelah lunas, alur pemilik berjalan sampai selesai", async () => {
    const placed = await order(preorder(A));
    const attempt = await claim(placed.token);
    await apply(fact(attempt.providerOrderId, "settlement", 240000));
    for (const action of ["confirm", "start_production", "mark_ready", "fulfill"] as const) {
      expect(await runOrderAction(A.client, placed.id, version(placed.id), action)).toEqual({ kind: "ok", value: undefined });
    }
    expect(orderRow(placed.id)).toBe("active|fulfilled");
  });
});

describe("pembayaran terlambat", () => {
  async function lateOrder(target = preorder(A), quantity = 2) {
    const placed = await order(target, { quantity, ttl: 1 });
    const attempt = await claim(placed.token);
    await sleep(1400);
    return { ...placed, attempt, target };
  }

  it("hold lewat: masuk tinjauan, tanpa alokasi dan tanpa email", async () => {
    const late = await lateOrder();
    expect(await apply(fact(late.attempt.providerOrderId, "settlement", 240000))).toMatchObject({ outcome: "review", orderStatus: "requires_review" });
    expect(orderRow(late.id)).toBe("requires_review|cancelled");
    expect(reservationState(late.id)).toBe("released");
    expect(paymentRow(late.attempt.paymentId)).toBe("paid_sandbox|false|false");
    expect(emailJobs(late.id)).toBe(0);
    expect((await findOrder(A.client, A.businessId, late.id))?.paymentState).toBe("unapplied");
    expect((await findOrderByPrivateToken(service, late.token))).toMatchObject({ orderStatus: "requires_review", paymentState: "unapplied", paymentVerifiedAt: null, canContinuePayment: false });
    expect((await findPreorder(A.client, A.businessId, late.target.id))?.metrics.paidUnits).toBe(0);
  });

  it("diterima: alokasi ulang, email sekali, lalu bisa dikonfirmasi", async () => {
    const late = await lateOrder();
    await apply(fact(late.attempt.providerOrderId, "settlement", 240000));

    expect(await acceptLatePayment(A.client, late.id, version(late.id), late.attempt.paymentId)).toEqual({ kind: "ok", value: undefined });

    expect(orderRow(late.id)).toBe("awaiting_confirmation|pending_confirmation");
    expect(reservationState(late.id)).toBe("allocated");
    expect(paymentRow(late.attempt.paymentId)).toBe("paid_sandbox|true|false");
    expect(emailJobs(late.id)).toBe(1);
    expect((await findPreorder(A.client, A.businessId, late.target.id))?.metrics.paidUnits).toBe(2);
    expect(await acceptLatePayment(A.client, late.id, version(late.id), late.attempt.paymentId)).toEqual({ kind: "rejected", violation: "ORDER_STATE_INVALID" });
    expect(emailJobs(late.id)).toBe(1);
    expect(await runOrderAction(A.client, late.id, version(late.id), "confirm")).toEqual({ kind: "ok", value: undefined });
  });

  it("kapasitas sudah terpakai: penerimaan ditolak dan tidak ada yang berubah", async () => {
    const target = preorder(A, { capacity: 2, quota: 2 });
    const late = await lateOrder(target, 2);
    await apply(fact(late.attempt.providerOrderId, "settlement", 240000));
    await order(target, { quantity: 2 });
    const beforeVersion = version(late.id);

    expect(await acceptLatePayment(A.client, late.id, beforeVersion, late.attempt.paymentId)).toEqual({ kind: "rejected", violation: "CAPACITY_UNAVAILABLE" });

    expect(orderRow(late.id)).toBe("requires_review|cancelled");
    expect(reservationState(late.id)).toBe("released");
    expect(emailJobs(late.id)).toBe(0);
    expect(version(late.id)).toBe(beforeVersion);
  });

  it("diterima bersamaan di slot terakhir: tepat satu berhasil", async () => {
    const target = preorder(A, { capacity: 2, quota: 2 });
    const first = await lateOrder(target, 2);
    const second = await lateOrder(target, 2);
    await apply(fact(first.attempt.providerOrderId, "settlement", 240000));
    await apply(fact(second.attempt.providerOrderId, "settlement", 240000));

    const results = await Promise.all([
      acceptLatePayment(A.client, first.id, version(first.id), first.attempt.paymentId),
      acceptLatePayment(A.client, second.id, version(second.id), second.attempt.paymentId),
    ]);

    expect(results.filter((result) => result.kind === "ok").length).toBe(1);
    expect(sql(`select coalesce(sum(quantity), 0) from public.capacity_reservations where capacity_id = '${target.capacityId}' and state = 'allocated'`)).toBe("2");
  });

  it("tidak diterima: kembali kedaluwarsa, fakta tetap ada, catatan tersimpan", async () => {
    const late = await lateOrder();
    await apply(fact(late.attempt.providerOrderId, "settlement", 240000));

    expect(await declineLatePayment(A.client, late.id, version(late.id), "Sudah dihubungi lewat WhatsApp")).toEqual({ kind: "ok", value: undefined });

    expect(orderRow(late.id)).toBe("expired|cancelled");
    expect(paymentRow(late.attempt.paymentId)).toBe("paid_sandbox|false|false");
    expect(emailJobs(late.id)).toBe(0);
    expect((await findOrder(A.client, A.businessId, late.id))).toMatchObject({ reviewReason: "Sudah dihubungi lewat WhatsApp", paymentState: "unapplied" });
    expect(await declineLatePayment(A.client, late.id, version(late.id), "lagi")).toEqual({ kind: "rejected", violation: "ORDER_STATE_INVALID" });
  });

  it("catatan kosong ditolak", async () => {
    const late = await lateOrder();
    await apply(fact(late.attempt.providerOrderId, "settlement", 240000));
    expect(await declineLatePayment(A.client, late.id, version(late.id), "   ")).toEqual({ kind: "rejected", violation: "VALIDATION_ERROR" });
  });

  it("versi lama ditolak", async () => {
    const late = await lateOrder();
    const stale = version(late.id);
    await apply(fact(late.attempt.providerOrderId, "settlement", 240000));
    expect(await acceptLatePayment(A.client, late.id, stale, late.attempt.paymentId)).toEqual({ kind: "rejected", violation: "VERSION_CONFLICT" });
  });

  it("tidak bisa dibatalkan atau dilanjutkan lewat jalur biasa", async () => {
    const late = await lateOrder();
    await apply(fact(late.attempt.providerOrderId, "settlement", 240000));
    expect(await cancelOrder(A.client, late.id, version(late.id), "coba")).toEqual({ kind: "rejected", violation: "ORDER_STATE_INVALID" });
    expect(await runOrderAction(A.client, late.id, version(late.id), "confirm")).toEqual({ kind: "rejected", violation: "ORDER_STATE_INVALID" });
  });

  it("pesanan dirapikan dulu lalu pembayaran masuk: tinjauan, percobaan ditutup, rekonsiliasi diantrekan", async () => {
    const late = await lateOrder();
    expect(await expireOrder(service, late.id, null)).toEqual({ kind: "ok", value: undefined });
    expect(paymentRow(late.attempt.paymentId)).toBe("expired|false|false");
    expect(sql(`select count(*) from public.job_runs where job_type = 'reconcile' and entity_id = '${late.attempt.paymentId}'`)).toBe("1");

    expect((await apply(fact(late.attempt.providerOrderId, "settlement", 240000))).outcome).toBe("review");
    expect(sql(`select review_reason from public.payments where id = '${late.attempt.paymentId}'`)).toBe("order_expired");
    expect(await declineLatePayment(A.client, late.id, version(late.id), "catatan")).toEqual({ kind: "ok", value: undefined });
    expect(orderRow(late.id)).toBe("expired|cancelled");
  });

  it("dibatalkan pemilik lalu pembayaran masuk: tinjauan, dan penolakan kembali ke batal", async () => {
    const placed = await order(preorder(A));
    const attempt = await claim(placed.token);
    expect(await cancelOrder(A.client, placed.id, version(placed.id), "Stok rusak")).toEqual({ kind: "ok", value: undefined });
    expect(paymentRow(attempt.paymentId)).toBe("cancelled|false|false");
    expect(sql(`select count(*) from public.job_runs where job_type = 'reconcile' and entity_id = '${attempt.paymentId}'`)).toBe("1");

    expect((await apply(fact(attempt.providerOrderId, "settlement", 240000))).outcome).toBe("review");
    expect(sql(`select review_reason from public.payments where id = '${attempt.paymentId}'`)).toBe("order_cancelled");
    expect(await declineLatePayment(A.client, placed.id, version(placed.id), "catatan")).toEqual({ kind: "ok", value: undefined });
    expect(orderRow(placed.id)).toBe("cancelled|cancelled");
  });

  it("batal melawan pembayaran bersamaan: status selalu konsisten", async () => {
    for (let round = 0; round < 5; round += 1) {
      const placed = await order(preorder(A));
      const attempt = await claim(placed.token);
      const currentVersion = version(placed.id);
      const [cancelled, applied] = await Promise.all([cancelOrder(A.client, placed.id, currentVersion, "Batal"), apply(fact(attempt.providerOrderId, "settlement", 240000))]);
      expect(sql(`select status from public.payments where id = '${attempt.paymentId}'`)).toBe("paid_sandbox");
      if (applied.outcome === "applied") {
        // Pembayaran menang: batal dengan versi lama wajib ditolak, dan pesanan lunas utuh.
        expect(cancelled).toEqual({ kind: "rejected", violation: "VERSION_CONFLICT" });
        expect(orderRow(placed.id)).toBe("awaiting_confirmation|pending_confirmation");
        expect(reservationState(placed.id)).toBe("allocated");
        expect(emailJobs(placed.id)).toBe(1);
      } else {
        // Batal menang: pembayaran masuk tinjauan, slot tetap lepas, dan tidak ada email sukses.
        expect(applied.outcome).toBe("review");
        expect(cancelled).toEqual({ kind: "ok", value: undefined });
        expect(orderRow(placed.id)).toBe("requires_review|cancelled");
        expect(reservationState(placed.id)).toBe("released");
        expect(emailJobs(placed.id)).toBe(0);
      }
    }
  });
});

describe("akses", () => {
  it("fungsi pembayaran hanya untuk server", async () => {
    const placed = await order(preorder(A));
    const attempt = await claim(placed.token);
    const args = { p_provider_order_id: attempt.providerOrderId, p_provider_event_key: "x", p_payload_hash: "x", p_provider_status: "settlement", p_provider_transaction_id: null, p_amount_idr: 240000, p_provider_paid_at: null };
    for (const client of [anon, A.client, B.client]) {
      expect((await client.rpc("apply_verified_payment", args)).error).not.toBeNull();
      expect((await client.rpc("claim_payment_attempt", { p_token_hash: "x" })).error).not.toBeNull();
      expect((await client.rpc("record_payment_charge", { p_payment_id: attempt.paymentId, p_provider_transaction_id: null, p_qr_content: "x", p_qr_expires_at: null })).error).not.toBeNull();
    }
    expect(orderRow(placed.id)).toBe("pending_payment|pending_confirmation");
  });

  it("usaha lain tidak bisa menerima, menolak, atau membaca pembayaran", async () => {
    const placed = await order(preorder(A), { ttl: 1 });
    const attempt = await claim(placed.token);
    await sleep(1400);
    await apply(fact(attempt.providerOrderId, "settlement", 240000));
    const current = version(placed.id);

    expect(await acceptLatePayment(B.client, placed.id, current, attempt.paymentId)).toEqual({ kind: "rejected", violation: "ORDER_NOT_FOUND" });
    expect(await declineLatePayment(B.client, placed.id, current, "x")).toEqual({ kind: "rejected", violation: "ORDER_NOT_FOUND" });
    expect(await listOrderPayments(B.client, B.businessId, placed.id)).toEqual([]);
    expect((await B.client.from("payments").select("id").eq("id", attempt.paymentId)).data).toEqual([]);
    expect(await listOrderPayments(B.client, A.businessId, placed.id)).toEqual([]);
    expect(orderRow(placed.id)).toBe("requires_review|cancelled");
  });

  it("pemilik hanya bisa membaca, tamu tidak bisa apa-apa, dan event tidak terbaca", async () => {
    const placed = await order(preorder(A));
    const attempt = await claim(placed.token);
    expect((await A.client.from("payments").update({ status: "paid_sandbox" }).eq("id", attempt.paymentId)).error).not.toBeNull();
    expect((await A.client.from("payments").insert({ business_id: A.businessId, order_id: placed.id, provider_order_id: "x", attempt_number: 9, amount_idr: 1, status: "paid_sandbox", is_active_attempt: false })).error).not.toBeNull();
    expect((await A.client.from("payment_events").select("id")).error).not.toBeNull();
    expect((await anon.from("payments").select("id")).error).not.toBeNull();
    expect(paymentRow(attempt.paymentId)).toBe("initiating|false|true");
  });

  it("menerima pembayaran dari pesanan lain ditolak", async () => {
    const target = preorder(A);
    const first = await order(target, { ttl: 1 });
    const firstAttempt = await claim(first.token);
    const other = await order(target);
    const otherAttempt = await claim(other.token);
    await sleep(1400);
    await apply(fact(firstAttempt.providerOrderId, "settlement", 240000));
    expect(await acceptLatePayment(A.client, first.id, version(first.id), otherAttempt.paymentId)).toEqual({ kind: "rejected", violation: "ORDER_STATE_INVALID" });
    expect(orderRow(first.id)).toBe("requires_review|cancelled");
  });

  it("riwayat event pembayaran tidak bisa diubah", () => {
    expect(() => sql(`update public.payment_events set outcome = 'applied' where id = (select id from public.payment_events limit 1)`)).toThrow();
  });

  it("job email tidak memuat data pelanggan", async () => {
    const placed = await order(preorder(A));
    const attempt = await claim(placed.token);
    await apply(fact(attempt.providerOrderId, "settlement", 240000));
    const job = sql(`select row_to_json(job_runs)::text from public.job_runs where entity_id = '${placed.id}'`);
    expect(job).not.toContain("pay-buyer");
    expect(job).not.toContain(placed.token);
    expect(job).not.toContain("Pembeli");
  });
});
