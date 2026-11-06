// Perintah pemilik: pesanan manual di luar preorder, tinjauan biaya, catatan pengembalian, batal preorder terbit, dan asal pesanan.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { findOrder, findOrderProductionCost, listBusinessOrders } from "@/features/orders/repository";
import { publicOrderSchema } from "@/features/orders/schemas";
import { cancelOrder, createManualOrder, createPrivateOrderToken, createStandaloneManualOrder, placePublicOrder, resolveProductionCost, runOrderAction } from "@/features/orders/service";
import { applyVerifiedPayment, claimPaymentAttempt } from "@/features/payments/service";
import { findPreorder, findPublicPreorder } from "@/features/preorders/repository";
import { anon, cleanupOwners, createCapacity, createOwner, createPublishedPreorder, service, sha256, sql, type Owner, type PreorderFixture } from "./helpers";

const stamp = Date.now();
const PREFIX = "own";
const STUB_ATTRIBUTION = "create or replace function private.resolve_attribution(p_preorder_id uuid, p_attribution_ref text) returns uuid language sql stable security definer set search_path = '' as $$ select null::uuid; $$;";

let A: Owner;
let B: Owner;
let unknownCost: Owner;

beforeAll(async () => {
  A = await createOwner(PREFIX, "a", stamp);
  B = await createOwner(PREFIX, "b", stamp);
  unknownCost = await createOwner(PREFIX, "c", stamp, { cost: null });
});

afterAll(() => {
  sql(STUB_ATTRIBUTION);
  cleanupOwners(PREFIX, stamp);
});

const version = (id: string) => Number(sql(`select version from public.orders where id = '${id}'`));
const orderRow = (id: string) => sql(`select order_status || '|' || fulfillment_status from public.orders where id = '${id}'`);
const reservationState = (id: string) => sql(`select state from public.capacity_reservations where order_id = '${id}'`);
const committed = (capacityId: string) => Number(sql(`select coalesce(sum(quantity), 0) from public.capacity_reservations where capacity_id = '${capacityId}' and (state = 'allocated' or (state = 'held' and expires_at > now()))`));

let keyCount = 0;
function standalone(capacityId: string, quantity = 2, paymentStatus: "paid" | "unpaid" = "paid", idempotencyKey: string = crypto.randomUUID()) {
  return { capacityId, idempotencyKey, customerName: "Manual", customerEmail: null, customerContact: null, quantity, paymentStatus };
}
function buyer(target: PreorderFixture, quantity = 2, extra: Record<string, unknown> = {}) {
  keyCount += 1;
  return publicOrderSchema.parse({ slug: target.slug, idempotencyKey: `own-key-${stamp}-${keyCount}-abcdef`, privateToken: createPrivateOrderToken(), customerName: "Pembeli", customerEmail: `own-buyer-${keyCount}@example.com`, customerContact: "", quantity, expectedUnitPriceIdr: 120000, ...extra });
}
async function placed(target: PreorderFixture, quantity = 2) {
  const input = buyer(target, quantity);
  const outcome = await placePublicOrder(service, input, 900);
  if (outcome.kind !== "ok") throw new Error(`order: ${outcome.violation}`);
  return { ...input, id: outcome.value.orderId };
}
async function paidOrder(target: PreorderFixture) {
  const order = await placed(target);
  const claim = await claimPaymentAttempt(service, order.privateToken);
  if (claim.kind !== "ok") throw new Error("claim");
  await applyVerifiedPayment(service, { providerOrderId: claim.value.providerOrderId, providerEventKey: `evt-${order.id}`, payloadHash: sha256("h"), providerStatus: "settlement", providerTransactionId: null, amountIdr: claim.value.amountIdr, providerPaidAt: new Date().toISOString() });
  return order;
}
async function manualInProduction(owner: Owner, target: PreorderFixture) {
  const outcome = await createManualOrder(owner.client, { preorderId: target.id, idempotencyKey: crypto.randomUUID(), customerName: "Manual", customerEmail: null, customerContact: null, quantity: 3, paymentStatus: "paid" });
  if (outcome.kind !== "ok") throw new Error(`manual: ${outcome.violation}`);
  const id = outcome.value.orderId;
  await runOrderAction(owner.client, id, version(id), "confirm");
  await runOrderAction(owner.client, id, version(id), "start_production");
  return id;
}

describe("pesanan manual di luar preorder", () => {
  it("memakai kapasitas, tanpa preorder, dengan harga dan snapshot dari produk", async () => {
    const { capacityId } = createCapacity(A, 10);
    const outcome = await createStandaloneManualOrder(A.client, standalone(capacityId, 3));
    expect(outcome).toMatchObject({ kind: "ok", value: { totalIdr: 360000, orderStatus: "awaiting_confirmation" } });
    if (outcome.kind !== "ok") return;

    expect(committed(capacityId)).toBe(3);
    const order = await findOrder(A.client, A.businessId, outcome.value.orderId);
    expect(order).toMatchObject({ preorderId: null, source: "manual", quantity: 3, unitPriceIdr: 120000, productName: "Kaos a", externalPaymentStatus: "confirmed" });
    expect(sql(`select preorder_item_id is null from public.capacity_reservations where order_id = '${outcome.value.orderId}'`)).toBe("t");
    expect((await listBusinessOrders(A.client, A.businessId)).some((row) => row.id === outcome.value.orderId)).toBe(true);
  });

  it("kirim ulang: pesanan sama. Isi berbeda: ditolak", async () => {
    const { capacityId } = createCapacity(A, 10);
    const key = crypto.randomUUID();
    const first = await createStandaloneManualOrder(A.client, standalone(capacityId, 2, "paid", key));
    expect(await createStandaloneManualOrder(A.client, standalone(capacityId, 2, "paid", key))).toMatchObject({ kind: "ok", value: { replayed: true } });
    expect(first).toMatchObject({ kind: "ok", value: { replayed: false } });
    expect(await createStandaloneManualOrder(A.client, standalone(capacityId, 5, "paid", key))).toEqual({ kind: "rejected", violation: "IDEMPOTENCY_CONFLICT" });
    expect(committed(capacityId)).toBe(2);
  });

  it("tidak melebihi kapasitas, dan mengurangi sisa preorder di jadwal yang sama", async () => {
    const schedule = createCapacity(A, 5);
    const target = createPublishedPreorder(A, PREFIX, stamp, { quota: 5, capacityId: schedule.capacityId, date: schedule.date });
    await createStandaloneManualOrder(A.client, standalone(schedule.capacityId, 3));

    expect((await findPublicPreorder(service, target.slug))?.orderableUnits).toBe(2);
    expect((await findPreorder(A.client, A.businessId, target.id))?.metrics.orderableUnits).toBe(2);
    expect(await createStandaloneManualOrder(A.client, standalone(schedule.capacityId, 3))).toEqual({ kind: "rejected", violation: "CAPACITY_UNAVAILABLE" });
    expect(await placePublicOrder(service, buyer(target, 3), 900)).toEqual({ kind: "rejected", violation: "CAPACITY_UNAVAILABLE" });
  });

  it("berebut slot terakhir dengan pembeli: tidak pernah melebihi kapasitas", async () => {
    for (let round = 0; round < 5; round += 1) {
      const schedule = createCapacity(A, 1);
      const target = createPublishedPreorder(A, PREFIX, stamp, { quota: 1, capacityId: schedule.capacityId, date: schedule.date });
      const results = await Promise.all([
        createStandaloneManualOrder(A.client, standalone(schedule.capacityId, 1)),
        placePublicOrder(service, buyer(target, 1), 900),
        createStandaloneManualOrder(A.client, standalone(schedule.capacityId, 1)),
        placePublicOrder(service, buyer(target, 1), 900),
      ]);
      expect(results.filter((result) => result.kind === "ok").length).toBe(1);
      expect(committed(schedule.capacityId)).toBe(1);
    }
  });

  it("produk nonaktif dan jadwal lewat ditolak", async () => {
    const inactive = await createOwner(PREFIX, "d", stamp);
    const { capacityId } = createCapacity(inactive, 5);
    sql(`update public.products set is_active = false where id = '${inactive.productId}'`);
    expect(await createStandaloneManualOrder(inactive.client, standalone(capacityId))).toEqual({ kind: "rejected", violation: "PRODUCT_INACTIVE" });

    const past = createCapacity(A, 5);
    sql(`begin; set local session_replication_role = replica; update public.production_capacity set intake_cutoff_at = now() - interval '2 days', fulfillment_window_end_at = now() - interval '1 day' where id = '${past.capacityId}'; commit;`);
    expect(await createStandaloneManualOrder(A.client, standalone(past.capacityId))).toEqual({ kind: "rejected", violation: "SCHEDULE_CLOSED" });
  });

  it("melewati batas pesan pembeli tetap boleh, selama jadwal pengambilan belum lewat", async () => {
    const { capacityId } = createCapacity(A, 5);
    sql(`update public.production_capacity set intake_cutoff_at = now() - interval '1 hour' where id = '${capacityId}'`);
    expect(await createStandaloneManualOrder(A.client, standalone(capacityId))).toMatchObject({ kind: "ok" });
  });

  it("usaha lain dan tamu ditolak, dan harga tidak bisa dipalsukan", async () => {
    const { capacityId } = createCapacity(A, 5);
    expect(await createStandaloneManualOrder(B.client, standalone(capacityId))).toEqual({ kind: "rejected", violation: "ORDER_NOT_FOUND" });
    await expect(createStandaloneManualOrder(anon, standalone(capacityId))).rejects.toThrow();
    await expect(createStandaloneManualOrder(service, standalone(capacityId))).rejects.toThrow();
    expect(committed(capacityId)).toBe(0);
  });

  it("alur pemenuhan penuh sampai selesai, dengan biaya sekali", async () => {
    const { capacityId } = createCapacity(A, 5);
    const outcome = await createStandaloneManualOrder(A.client, standalone(capacityId, 2));
    if (outcome.kind !== "ok") throw new Error("order");
    const id = outcome.value.orderId;
    for (const action of ["confirm", "start_production", "mark_ready", "fulfill"] as const) {
      expect(await runOrderAction(A.client, id, version(id), action)).toEqual({ kind: "ok", value: undefined });
    }
    expect(orderRow(id)).toBe("active|fulfilled");
    expect(reservationState(id)).toBe("allocated");
    expect(await findOrderProductionCost(A.client, A.businessId, id)).toMatchObject({ amountIdr: 150000, quality: "estimated", quantity: 2 });
  });
});

describe("tinjauan biaya produksi", () => {
  it("biaya kosong saat produksi bisa dilengkapi sekali, snapshot item tidak berubah", async () => {
    const id = await manualInProduction(unknownCost, createPublishedPreorder(unknownCost, PREFIX, stamp));
    expect(await findOrderProductionCost(unknownCost.client, unknownCost.businessId, id)).toMatchObject({ amountIdr: null, quality: "unknown", quantity: 3 });

    expect(await resolveProductionCost(unknownCost.client, id, version(id), { costPerUnitIdr: 80000, quality: "verified", note: "Nota bahan 3 November" })).toEqual({ kind: "ok", value: undefined });

    expect(await findOrderProductionCost(unknownCost.client, unknownCost.businessId, id)).toMatchObject({ amountIdr: 240000, quality: "verified", resolutionNote: "Nota bahan 3 November" });
    expect(sql(`select cost.resolved_by_user_id = '${unknownCost.userId}' from public.order_production_costs cost join public.order_items item on item.id = cost.order_item_id where item.order_id = '${id}'`)).toBe("t");
    expect(sql(`select variable_cost_per_unit_idr is null and cost_quality_snapshot = 'unknown' from public.order_items where order_id = '${id}'`)).toBe("t");
    expect(sql(`select count(*) from public.order_events where order_id = '${id}' and event_type = 'production_cost_resolved'`)).toBe("1");
    expect(await resolveProductionCost(unknownCost.client, id, version(id), { costPerUnitIdr: 1, quality: "verified", note: "ubah" })).toEqual({ kind: "rejected", violation: "ORDER_STATE_INVALID" });
  });

  it("nol sah, dan berbeda dari kosong", async () => {
    const id = await manualInProduction(unknownCost, createPublishedPreorder(unknownCost, PREFIX, stamp));
    await resolveProductionCost(unknownCost.client, id, version(id), { costPerUnitIdr: 0, quality: "verified", note: "Bahan hibah" });
    expect(await findOrderProductionCost(unknownCost.client, unknownCost.businessId, id)).toMatchObject({ amountIdr: 0, quality: "verified" });
  });

  it("biaya yang sudah ada tidak bisa diganti lewat jalur ini", async () => {
    const id = await manualInProduction(A, createPublishedPreorder(A, PREFIX, stamp));
    expect(await resolveProductionCost(A.client, id, version(id), { costPerUnitIdr: 1, quality: "verified", note: "ubah" })).toEqual({ kind: "rejected", violation: "ORDER_STATE_INVALID" });
    expect(await findOrderProductionCost(A.client, A.businessId, id)).toMatchObject({ amountIdr: 225000 });
  });

  it("belum produksi: tidak ada biaya yang bisa dilengkapi", async () => {
    const outcome = await createManualOrder(unknownCost.client, { preorderId: createPublishedPreorder(unknownCost, PREFIX, stamp).id, idempotencyKey: crypto.randomUUID(), customerName: "Manual", customerEmail: null, customerContact: null, quantity: 1, paymentStatus: "paid" });
    if (outcome.kind !== "ok") throw new Error("order");
    expect(await resolveProductionCost(unknownCost.client, outcome.value.orderId, version(outcome.value.orderId), { costPerUnitIdr: 1, quality: "verified", note: "x" })).toEqual({ kind: "rejected", violation: "ORDER_STATE_INVALID" });
  });

  it("masukan tidak sah, versi lama, usaha lain, dan server ditolak", async () => {
    const id = await manualInProduction(unknownCost, createPublishedPreorder(unknownCost, PREFIX, stamp));
    const current = version(id);
    const valid = { costPerUnitIdr: 1000, quality: "verified" as const, note: "Catatan" };
    expect(await resolveProductionCost(unknownCost.client, id, current, { ...valid, note: "   " })).toEqual({ kind: "rejected", violation: "VALIDATION_ERROR" });
    expect(await resolveProductionCost(unknownCost.client, id, current, { ...valid, costPerUnitIdr: -1 })).toEqual({ kind: "rejected", violation: "VALIDATION_ERROR" });
    expect(await resolveProductionCost(unknownCost.client, id, current - 1, valid)).toEqual({ kind: "rejected", violation: "VERSION_CONFLICT" });
    expect(await resolveProductionCost(B.client, id, current, valid)).toEqual({ kind: "rejected", violation: "ORDER_NOT_FOUND" });
    await expect(resolveProductionCost(service, id, current, valid)).rejects.toThrow();
    await expect(resolveProductionCost(anon, id, current, valid)).rejects.toThrow();
    expect(await findOrderProductionCost(unknownCost.client, unknownCost.businessId, id)).toMatchObject({ quality: "unknown", amountIdr: null });
  });

  it("batal setelah produksi: biaya tetap ada dan masih bisa dilengkapi", async () => {
    const id = await manualInProduction(unknownCost, createPublishedPreorder(unknownCost, PREFIX, stamp));
    await cancelOrder(unknownCost.client, id, version(id), "Batal", "Sudah dikembalikan");
    expect(reservationState(id)).toBe("allocated");
    expect(await resolveProductionCost(unknownCost.client, id, version(id), { costPerUnitIdr: 5000, quality: "estimated", note: "Biaya terlanjur" })).toEqual({ kind: "ok", value: undefined });
    expect(await findOrderProductionCost(unknownCost.client, unknownCost.businessId, id)).toMatchObject({ amountIdr: 15000, quality: "estimated" });
  });
});

describe("catatan pengembalian", () => {
  async function manual(paymentStatus: "paid" | "unpaid") {
    const outcome = await createManualOrder(A.client, { preorderId: createPublishedPreorder(A, PREFIX, stamp).id, idempotencyKey: crypto.randomUUID(), customerName: "Manual", customerEmail: null, customerContact: null, quantity: 1, paymentStatus });
    if (outcome.kind !== "ok") throw new Error("order");
    return outcome.value.orderId;
  }

  it("manual lunas tanpa catatan ditolak, dengan catatan tersimpan", async () => {
    const id = await manual("paid");
    expect(await cancelOrder(A.client, id, version(id), "Batal")).toEqual({ kind: "rejected", violation: "REFUND_NOTE_REQUIRED" });
    expect(await cancelOrder(A.client, id, version(id), "Batal", "   ")).toEqual({ kind: "rejected", violation: "REFUND_NOTE_REQUIRED" });
    expect(orderRow(id)).toBe("awaiting_confirmation|pending_confirmation");
    expect(await cancelOrder(A.client, id, version(id), "Batal", "Dikembalikan tunai")).toEqual({ kind: "ok", value: undefined });
    expect(await findOrder(A.client, A.businessId, id)).toMatchObject({ orderStatus: "cancelled", reviewReason: "Dikembalikan tunai", cancelReason: "Batal" });
    expect(reservationState(id)).toBe("released");
  });

  it("manual belum bayar dan pembeli belum bayar tidak perlu catatan", async () => {
    const unpaid = await manual("unpaid");
    expect(await cancelOrder(A.client, unpaid, version(unpaid), "Batal")).toEqual({ kind: "ok", value: undefined });
    expect(await findOrder(A.client, A.businessId, unpaid)).toMatchObject({ externalPaymentStatus: "voided", reviewReason: null });

    const pending = await placed(createPublishedPreorder(A, PREFIX, stamp));
    expect(await cancelOrder(A.client, pending.id, version(pending.id), "Batal")).toEqual({ kind: "ok", value: undefined });
  });

  it("pembeli sudah lunas sandbox wajib catatan", async () => {
    const order = await paidOrder(createPublishedPreorder(A, PREFIX, stamp));
    expect(await cancelOrder(A.client, order.id, version(order.id), "Batal")).toEqual({ kind: "rejected", violation: "REFUND_NOTE_REQUIRED" });
    expect(await cancelOrder(A.client, order.id, version(order.id), "Batal", "Sandbox, tidak ada uang nyata")).toEqual({ kind: "ok", value: undefined });
    expect(await findOrder(A.client, A.businessId, order.id)).toMatchObject({ orderStatus: "cancelled", paymentState: "applied", reviewReason: "Sandbox, tidak ada uang nyata" });
  });
});

describe("batal preorder terbit", () => {
  const cancel = (owner: Owner, id: string, expected: number) => owner.client.rpc("cancel_published_preorder", { p_preorder_id: id, p_expected_version: expected });
  const preorderVersion = (id: string) => Number(sql(`select version from public.preorders where id = '${id}'`));

  it("tanpa pesanan: batal, tautan tertutup, dan tanggal bisa dipakai lagi", async () => {
    const schedule = createCapacity(A, 10);
    const target = createPublishedPreorder(A, PREFIX, stamp, { quota: 10, capacityId: schedule.capacityId, date: schedule.date });
    expect((await cancel(A, target.id, preorderVersion(target.id))).error).toBeNull();
    expect(sql(`select status from public.preorders where id = '${target.id}'`)).toBe("cancelled");
    expect(await findPublicPreorder(service, target.slug)).toBeNull();
    expect(await placePublicOrder(service, buyer(target), 900)).toEqual({ kind: "rejected", violation: "PREORDER_NOT_OPEN" });
    expect(() => createPublishedPreorder(A, PREFIX, stamp, { quota: 10, capacityId: schedule.capacityId, date: schedule.date })).not.toThrow();
  });

  it.each([["pembeli"], ["manual"]])("sudah ada pesanan %s: ditolak", async (kind) => {
    const target = createPublishedPreorder(A, PREFIX, stamp);
    if (kind === "pembeli") await placed(target);
    else await createManualOrder(A.client, { preorderId: target.id, idempotencyKey: crypto.randomUUID(), customerName: "M", customerEmail: null, customerContact: null, quantity: 1, paymentStatus: "paid" });
    expect((await cancel(A, target.id, preorderVersion(target.id))).error?.message).toContain("PREORDER_HAS_ORDERS");
    expect(sql(`select status from public.preorders where id = '${target.id}'`)).toBe("published");
  });

  it("pesanan yang sudah batal tetap menghalangi, karena riwayatnya ada", async () => {
    const target = createPublishedPreorder(A, PREFIX, stamp);
    const order = await placed(target);
    await cancelOrder(A.client, order.id, version(order.id), "Batal");
    expect((await cancel(A, target.id, preorderVersion(target.id))).error?.message).toContain("PREORDER_HAS_ORDERS");
  });

  it("melawan pesanan baru bersamaan: tidak pernah preorder batal dengan pesanan", async () => {
    for (let round = 0; round < 8; round += 1) {
      const target = createPublishedPreorder(A, PREFIX, stamp);
      const [cancelled, order] = await Promise.all([cancel(A, target.id, preorderVersion(target.id)), placePublicOrder(service, buyer(target, 1), 900)]);
      const status = sql(`select status from public.preorders where id = '${target.id}'`);
      const orders = Number(sql(`select count(*) from public.orders where preorder_id = '${target.id}'`));
      expect(status === "cancelled" ? orders : 0).toBe(0);
      expect(cancelled.error === null).toBe(status === "cancelled");
      expect(order.kind === "ok").toBe(orders === 1);
    }
  });

  it("draf, tertutup, versi lama, usaha lain, dan tamu ditolak", async () => {
    const draft = createPublishedPreorder(A, PREFIX, stamp, { status: "draft" });
    expect((await cancel(A, draft.id, preorderVersion(draft.id))).error?.message).toContain("PREORDER_NOT_PUBLISHED");
    const target = createPublishedPreorder(A, PREFIX, stamp);
    expect((await cancel(A, target.id, preorderVersion(target.id) + 1)).error?.message).toContain("PREORDER_VERSION_CONFLICT");
    expect((await cancel(B, target.id, preorderVersion(target.id))).error?.message).toContain("PREORDER_NOT_FOUND");
    expect((await anon.rpc("cancel_published_preorder", { p_preorder_id: target.id, p_expected_version: 1 })).error).not.toBeNull();
    expect((await service.rpc("cancel_published_preorder", { p_preorder_id: target.id, p_expected_version: 1 })).error).not.toBeNull();
    expect(sql(`select status from public.preorders where id = '${target.id}'`)).toBe("published");
  });
});

describe("colokan asal pesanan", () => {
  it("tanpa kampanye: referensi apa pun tetap jadi pesanan, tanpa asal", async () => {
    const outcome = await placePublicOrder(service, buyer(createPublishedPreorder(A, PREFIX, stamp), 1, { attributionRef: "tautan-kampanye" }), 900);
    expect(outcome.kind).toBe("ok");
    if (outcome.kind === "ok") expect(sql(`select attribution_campaign_id is null from public.orders where id = '${outcome.value.orderId}'`)).toBe("t");
  });

  it("setelah colokan diisi: asal tercatat terpisah dari harga, dan harga tidak berubah", async () => {
    const target = createPublishedPreorder(A, PREFIX, stamp);
    // FK baseline: asal pesanan wajib menunjuk kampanye sungguhan pada preorder yang sama.
    const campaign = sql(`insert into public.campaigns (business_id, preorder_id, name, status, offer_type, marketing_approach, discount_bps, budget_cap_idr, primary_kpi, target_additional_units, starts_at, ends_at, costs_completeness)
      select business_id, id, 'Kampanye uji', 'draft', 'normal_price', 'value_content', 0, 0, 'paid_units_in_window', 1, starts_at, ends_at, 'unreviewed'
      from public.preorders where id = '${target.id}' returning id`);
    sql(`create or replace function private.resolve_attribution(p_preorder_id uuid, p_attribution_ref text) returns uuid language sql stable security definer set search_path = '' as $$ select case when p_attribution_ref = 'sah' then '${campaign}'::uuid end; $$;`);
    try {
      const valid = await placePublicOrder(service, buyer(target, 1, { attributionRef: "sah" }), 900);
      const invalid = await placePublicOrder(service, buyer(target, 1, { attributionRef: "palsu" }), 900);
      const organic = await placePublicOrder(service, buyer(target, 1), 900);
      if (valid.kind !== "ok" || invalid.kind !== "ok" || organic.kind !== "ok") throw new Error("order");
      expect(sql(`select attribution_campaign_id, pricing_campaign_id is null, total_idr from public.orders where id = '${valid.value.orderId}'`)).toBe(`${campaign}|t|120000`);
      expect(sql(`select attribution_campaign_id is null, total_idr from public.orders where id = '${invalid.value.orderId}'`)).toBe("t|120000");
      expect(sql(`select attribution_campaign_id is null, total_idr from public.orders where id = '${organic.value.orderId}'`)).toBe("t|120000");
    } finally {
      sql(STUB_ATTRIBUTION);
    }
  });

  it("kunci sama dengan referensi berbeda dianggap isi berbeda", async () => {
    const target = createPublishedPreorder(A, PREFIX, stamp);
    const input = buyer(target, 1, { attributionRef: "satu" });
    await placePublicOrder(service, input, 900);
    expect(await placePublicOrder(service, { ...input, attributionRef: "dua" }, 900)).toEqual({ kind: "rejected", violation: "IDEMPOTENCY_CONFLICT" });
    expect(await placePublicOrder(service, input, 900)).toMatchObject({ kind: "ok", value: { replayed: true } });
  });

  it("referensi terlalu panjang ditolak schema dan database", async () => {
    const target = createPublishedPreorder(A, PREFIX, stamp);
    expect(publicOrderSchema.safeParse({ ...buyer(target), attributionRef: "x".repeat(201) }).success).toBe(false);
    const { error } = await service.rpc("create_preorder_order", { p_slug: target.slug, p_quantity: 1, p_customer_name: "P", p_customer_email: "own-long@example.com", p_customer_contact: null, p_token_hash: sha256("h"), p_idempotency_key: `own-long-${stamp}`, p_request_hash: sha256("r"), p_expected_unit_price_idr: 120000, p_hold_ttl_seconds: 900, p_attribution_ref: "x".repeat(201) });
    expect(error?.message).toContain("VALIDATION_ERROR");
  });
});
