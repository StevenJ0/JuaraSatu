// Uji baca pesanan lewat token terhadap Supabase lokal sungguhan, memakai placePublicOrder asli. Data uji dibersihkan. Nilai key tidak dicetak.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { publicOrderSchema } from "@/features/orders/schemas";
import { createPrivateOrderToken, findOrderByPrivateToken, hashPrivateOrderToken, placePublicOrder } from "@/features/orders/service";
import { anon, service, sql } from "./helpers";

const stamp = Date.now();
const COST = 75317;

function seed(label: string, day: number) {
  const businessId = sql(`insert into public.businesses (name, slug, categories, public_contact, pickup_instructions)
    values ('Usaha ${label}', 'tok-${label}-${stamp}', array['Fashion'], '0812-profil', 'Petunjuk profil') returning id`);
  const productId = sql(`insert into public.products (business_id, name, sku, base_price_idr, variable_cost_idr, cost_quality)
    values ('${businessId}', 'Kaos ${label}', 'SKUTOK${stamp}${label}', 120000, ${COST}, 'estimated') returning id`);
  const date = new Date(Date.now() + day * 86400e3).toISOString().slice(0, 10);
  const capacityId = sql(`insert into public.production_capacity (business_id, product_id, fulfillment_date, total_units, intake_cutoff_at, fulfillment_window_end_at)
    values ('${businessId}', '${productId}', '${date}', 50, now() + interval '6 days', '${date} 17:00+07') returning id`);
  const slug = `tok-${label}-${stamp}`;
  const preorderId = sql(`insert into public.preorders (business_id, name, slug, status, fulfillment_date, starts_at, ends_at, pickup_terms_snapshot)
    values ('${businessId}', 'Preorder ${label}', '${slug}', 'published', '${date}', now() - interval '1 day', now() + interval '5 days',
      jsonb_build_object('pickup_instructions', 'Ambil beku ${label}', 'public_contact', '0812-beku', 'intake_cutoff_at', now() + interval '6 days', 'fulfillment_window_end_at', '${date} 17:00+07'::timestamptz)) returning id`);
  sql(`insert into public.preorder_items (business_id, preorder_id, product_id, capacity_id, target_units, quota_units, base_price_snapshot_idr, product_name_snapshot, sku_snapshot)
    values ('${businessId}', '${preorderId}', '${productId}', '${capacityId}', 10, 40, 120000, 'Kaos beku ${label}', 'SKUTOK${stamp}${label}')`);
  return { businessId, slug, preorderId };
}

let count = 0;
async function order(slug: string, quantity: number, holdTtlSeconds = 900) {
  count += 1;
  const token = createPrivateOrderToken();
  const buyer = { name: `PembeliRahasia${stamp}${count}`, email: `tok-buyer-${stamp}-${count}@example.com`, contact: `0899${stamp}${count}` };
  const input = publicOrderSchema.parse({
    slug,
    idempotencyKey: `tok-key-${stamp}-${count}-abcdef`,
    privateToken: token,
    customerName: buyer.name,
    customerEmail: buyer.email,
    customerContact: buyer.contact,
    quantity,
    expectedUnitPriceIdr: 120000,
  });
  const outcome = await placePublicOrder(service, input, holdTtlSeconds);
  if (outcome.kind !== "ok") throw new Error(`order: ${outcome.violation}`);
  return { token, buyer, orderId: outcome.value.orderId, number: outcome.value.publicOrderNumber };
}

let A: ReturnType<typeof seed>;
let B: ReturnType<typeof seed>;

beforeAll(() => {
  A = seed("a", 200);
  B = seed("b", 201);
});

afterAll(() => {
  sql(`begin;
    create temp table doomed on commit drop as select id from public.businesses where slug like 'tok-%-${stamp}';
    set local session_replication_role = replica;
    delete from public.capacity_reservations where business_id in (select id from doomed);
    delete from public.order_events where business_id in (select id from doomed);
    delete from public.order_items where business_id in (select id from doomed);
    delete from public.orders where business_id in (select id from doomed);
    delete from public.preorder_items where business_id in (select id from doomed);
    delete from public.preorders where business_id in (select id from doomed);
    delete from public.production_capacity where business_id in (select id from doomed);
    delete from public.products where business_id in (select id from doomed);
    delete from public.businesses where id in (select id from doomed);
    commit;`);
});

describe("findOrderByPrivateToken di database sungguhan", () => {
  it("acceptance: token pembeli A hanya menampilkan pesanan A, token B hanya pesanan B", async () => {
    const first = await order(A.slug, 2);
    const second = await order(A.slug, 3);
    const other = await order(B.slug, 1);

    expect(await findOrderByPrivateToken(service, first.token)).toMatchObject({ publicOrderNumber: first.number, quantity: 2, totalIdr: 240000 });
    expect(await findOrderByPrivateToken(service, second.token)).toMatchObject({ publicOrderNumber: second.number, quantity: 3, totalIdr: 360000 });
    expect(await findOrderByPrivateToken(service, other.token)).toMatchObject({ publicOrderNumber: other.number, businessName: "Usaha b" });
  });

  it("isi lengkap dari satu query, dengan pickup yang dibekukan", async () => {
    const placed = await order(A.slug, 2);
    sql(`update public.businesses set pickup_instructions = 'Profil berubah' where id = '${A.businessId}'`);

    const status = await findOrderByPrivateToken(service, placed.token);

    expect(status).toMatchObject({
      orderStatus: "pending_payment",
      fulfillmentStatus: "pending_confirmation",
      businessName: "Usaha a",
      preorderName: "Preorder a",
      productName: "Kaos beku a",
      sku: `SKUTOK${stamp}a`,
      paymentState: "none",
      paymentVerifiedAt: null,
      canContinuePayment: true,
      baseUnitPriceIdr: 120000,
      discountPerUnitIdr: 0,
      finalUnitPriceIdr: 120000,
      subtotalIdr: 240000,
      discountTotalIdr: 0,
      totalIdr: 240000,
      pickup: { instructions: "Ambil beku a", publicContact: "0812-beku" },
    });
    expect(Date.parse(status?.paymentDueAt ?? "")).toBeGreaterThan(Date.now());
  });

  it("tidak memuat data pelanggan, token, hash, biaya, SKU, atau id internal", async () => {
    const placed = await order(A.slug, 1);
    const text = JSON.stringify(await findOrderByPrivateToken(service, placed.token));

    const forbidden = [placed.buyer.name, placed.buyer.email, placed.buyer.contact, placed.token, hashPrivateOrderToken(placed.token), String(COST), placed.orderId, A.businessId, A.preorderId, "customer", "token", "variable"];
    for (const value of forbidden) expect(text.includes(value), value).toBe(false);
  });

  it("token salah, kosong, pendek, atau berisi hash tidak menemukan apa pun", async () => {
    const placed = await order(A.slug, 1);

    expect(await findOrderByPrivateToken(service, createPrivateOrderToken())).toBeNull();
    expect(await findOrderByPrivateToken(service, "")).toBeNull();
    expect(await findOrderByPrivateToken(service, "pendek")).toBeNull();
    expect(await findOrderByPrivateToken(service, "x".repeat(257))).toBeNull();
    expect(await findOrderByPrivateToken(service, placed.token.slice(0, -1) + (placed.token.endsWith("A") ? "B" : "A"))).toBeNull();
    // Hash yang bocor dari database tidak bisa dipakai sebagai token.
    expect(await findOrderByPrivateToken(service, hashPrivateOrderToken(placed.token))).toBeNull();
    expect(await findOrderByPrivateToken(service, "a'; drop table public.orders; --".padEnd(40, "x"))).toBeNull();
    expect(await findOrderByPrivateToken(service, "a,b.c(d)*%".padEnd(40, "x"))).toBeNull();
  });

  it("idempotency key, nomor pesanan, dan id pesanan tidak berlaku sebagai token", async () => {
    const placed = await order(A.slug, 1);
    expect(await findOrderByPrivateToken(service, placed.orderId)).toBeNull();
    expect(await findOrderByPrivateToken(service, `tok-key-${stamp}-${count}-abcdef`.padEnd(40, "x"))).toBeNull();
    expect(await findOrderByPrivateToken(service, placed.number.padEnd(40, "x"))).toBeNull();
  });

  it("client tamu tanpa service role ditolak database", async () => {
    const placed = await order(A.slug, 1);
    await expect(findOrderByPrivateToken(anon, placed.token)).rejects.toThrow();
  });

  it("pesanan manual tanpa token tidak bisa dicari", async () => {
    expect(sql(`select count(*) from public.orders where source = 'manual' and private_token_hash is not null`)).toBe("0");
  });

  it("tenggat bayar lewat dibaca kedaluwarsa walau baris belum dirapikan", async () => {
    const placed = await order(A.slug, 1, 1);
    await new Promise((resolve) => setTimeout(resolve, 1500));

    expect(sql(`select order_status from public.orders where id = '${placed.orderId}'`)).toBe("pending_payment");
    expect((await findOrderByPrivateToken(service, placed.token))?.orderStatus).toBe("expired");
  });

  it("preorder sudah ditutup: pesanan lama tetap bisa dilacak", async () => {
    const placed = await order(B.slug, 1);
    sql(`update public.preorders set status = 'closed', closed_at = now() where id = '${B.preorderId}'`);
    expect(await findOrderByPrivateToken(service, placed.token)).toMatchObject({ publicOrderNumber: placed.number, preorderName: "Preorder b" });
    sql(`update public.preorders set status = 'published' where id = '${B.preorderId}'`);
  });

  it("pesanan batal: status terbaca, alasannya tidak ikut", async () => {
    const placed = await order(A.slug, 1);
    sql(`update public.orders set order_status = 'cancelled', fulfillment_status = 'cancelled', cancelled_at = now(), cancel_reason = 'AlasanInternal${stamp}' where id = '${placed.orderId}'`);

    const status = await findOrderByPrivateToken(service, placed.token);

    expect(status).toMatchObject({ orderStatus: "cancelled", fulfillmentStatus: "cancelled" });
    expect(JSON.stringify(status)).not.toContain(`AlasanInternal${stamp}`);
  });
});
