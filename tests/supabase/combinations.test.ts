// Kombinasi fitur: setiap sumber pesanan dikali setiap titik berhenti, lalu urutan acak dengan pemeriksaan invarian di setiap langkah.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { findOrder, findOrderProductionCost } from "@/features/orders/repository";
import { publicOrderSchema } from "@/features/orders/schemas";
import {
  acceptLatePayment,
  cancelOrder,
  createManualOrder,
  createPrivateOrderToken,
  createStandaloneManualOrder,
  expireOrder,
  placePublicOrder,
  resolveProductionCost,
  runOrderAction,
} from "@/features/orders/service";
import { nextOrderStep, type OrderStatusFacts } from "@/features/orders/status";
import { applyVerifiedPayment, claimPaymentAttempt } from "@/features/payments/service";
import { findPreorder, findPublicPreorder } from "@/features/preorders/repository";
import { cleanupOwners, createOwner, createPublishedPreorder, service, sha256, sleep, sql, type Owner, type PreorderFixture } from "./helpers";

const stamp = Date.now();
const PREFIX = "cmb";
let A: Owner;

beforeAll(async () => {
  A = await createOwner(PREFIX, "a", stamp);
});

afterAll(() => {
  cleanupOwners(PREFIX, stamp);
});

const version = (id: string) => Number(sql(`select version from public.orders where id = '${id}'`));
const reservationState = (id: string) => sql(`select state from public.capacity_reservations where order_id = '${id}'`);
let counter = 0;

type Source = "public_paid" | "public_late_accepted" | "manual_paid" | "manual_unpaid" | "standalone_paid" | "standalone_unpaid";
const SOURCES: Source[] = ["public_paid", "public_late_accepted", "manual_paid", "manual_unpaid", "standalone_paid", "standalone_unpaid"];

async function settle(token: string, amountIdr: number) {
  const claim = await claimPaymentAttempt(service, token);
  if (claim.kind !== "ok") throw new Error(`claim: ${claim.violation}`);
  counter += 1;
  return applyVerifiedPayment(service, { providerOrderId: claim.value.providerOrderId, providerEventKey: `cmb-${stamp}-${counter}`, payloadHash: sha256("h"), providerStatus: "settlement", providerTransactionId: null, amountIdr, providerPaidAt: null });
}

async function placeBuyer(target: PreorderFixture, quantity: number, ttl = 900) {
  counter += 1;
  const token = createPrivateOrderToken();
  const outcome = await placePublicOrder(service, publicOrderSchema.parse({ slug: target.slug, idempotencyKey: `cmb-key-${stamp}-${counter}-abcdef`, privateToken: token, customerName: "P", customerEmail: `cmb-${counter}@example.com`, customerContact: "", quantity, expectedUnitPriceIdr: 120000 }), ttl);
  return outcome.kind === "ok" ? { id: outcome.value.orderId, token, total: outcome.value.totalIdr } : null;
}

/** Membuat pesanan dari sumber tertentu sampai siap dikonfirmasi pemilik. */
async function createFrom(source: Source, target: PreorderFixture): Promise<string> {
  const manual = { idempotencyKey: crypto.randomUUID(), customerName: "M", customerEmail: null, customerContact: null, quantity: 2 };
  if (source === "public_paid" || source === "public_late_accepted") {
    const order = await placeBuyer(target, 2, source === "public_late_accepted" ? 1 : 900);
    if (!order) throw new Error("place");
    if (source === "public_late_accepted") {
      await claimPaymentAttempt(service, order.token);
      await sleep(1300);
      const applied = await applyVerifiedPayment(service, { providerOrderId: sql(`select provider_order_id from public.payments where order_id = '${order.id}'`), providerEventKey: `late-${order.id}`, payloadHash: sha256("h"), providerStatus: "settlement", providerTransactionId: null, amountIdr: order.total, providerPaidAt: null });
      if (applied.kind !== "ok" || applied.value.outcome !== "review") throw new Error("late");
      const paymentId = sql(`select id from public.payments where order_id = '${order.id}'`);
      const accepted = await acceptLatePayment(A.client, order.id, version(order.id), paymentId);
      if (accepted.kind !== "ok") throw new Error(`accept: ${accepted.violation}`);
    } else {
      await settle(order.token, order.total);
    }
    return order.id;
  }
  const outcome = source.startsWith("manual")
    ? await createManualOrder(A.client, { ...manual, preorderId: target.id, paymentStatus: source === "manual_paid" ? "paid" : "unpaid" })
    : await createStandaloneManualOrder(A.client, { ...manual, capacityId: target.capacityId, paymentStatus: source === "standalone_paid" ? "paid" : "unpaid" });
  if (outcome.kind !== "ok") throw new Error(`manual: ${outcome.violation}`);
  return outcome.value.orderId;
}

async function facts(id: string): Promise<OrderStatusFacts> {
  const order = await findOrder(A.client, A.businessId, id);
  if (!order) throw new Error("order");
  return order;
}

/** Menjalankan langkah pemilik berikutnya sebanyak `steps` kali. */
async function advance(id: string, steps: number) {
  for (let step = 0; step < steps; step += 1) {
    const next = nextOrderStep(await facts(id));
    if (!next) throw new Error("tidak ada langkah");
    const result = await runOrderAction(A.client, id, version(id), next.action);
    if (result.kind !== "ok") throw new Error(`${next.action}: ${result.violation}`);
  }
}

describe("matriks sumber pesanan dikali titik berhenti", () => {
  // 0: belum dikonfirmasi, 1: dikonfirmasi, 2: produksi, 3: siap, 4: diambil. Pesanan belum lunas punya satu langkah tambahan di depan.
  const STOPS = [0, 1, 2, 3, 4] as const;

  for (const source of SOURCES) {
    for (const stop of STOPS) {
      it(`${source} berhenti di tahap ${stop}, lalu dibatalkan bila boleh`, async () => {
        const target = createPublishedPreorder(A, PREFIX, stamp, { quota: 10, capacity: 10 });
        const id = await createFrom(source, target);
        const unpaid = source.endsWith("unpaid");
        await advance(id, stop + (unpaid && stop > 0 ? 1 : 0));

        const before = await facts(id);
        const productionStarted = stop >= 2;
        expect(Boolean(await findOrderProductionCost(A.client, A.businessId, id))).toBe(productionStarted);

        if (stop === 4) {
          expect(before).toMatchObject({ orderStatus: "active", fulfillmentStatus: "fulfilled" });
          expect(await cancelOrder(A.client, id, version(id), "Coba")).toEqual({ kind: "rejected", violation: "ORDER_STATE_INVALID" });
          expect(reservationState(id)).toBe("allocated");
          return;
        }

        const paid = !unpaid || stop > 0;
        if (paid) expect(await cancelOrder(A.client, id, version(id), "Batal")).toEqual({ kind: "rejected", violation: "REFUND_NOTE_REQUIRED" });
        expect(await cancelOrder(A.client, id, version(id), "Batal", paid ? "Catatan" : null)).toEqual({ kind: "ok", value: undefined });

        expect(reservationState(id)).toBe(productionStarted ? "allocated" : "released");
        expect(sql(`select count(*) from public.order_production_costs cost join public.order_items item on item.id = cost.order_item_id where item.order_id = '${id}'`)).toBe(productionStarted ? "1" : "0");
        expect(await cancelOrder(A.client, id, version(id), "Lagi", "Lagi")).toEqual({ kind: "rejected", violation: "ORDER_STATE_INVALID" });
        expect(nextOrderStep(await facts(id))).toBeNull();

        // Angka dashboard dan halaman pembeli tetap sama setelah setiap kombinasi.
        const owner = await findPreorder(A.client, A.businessId, target.id);
        const buyer = await findPublicPreorder(service, target.slug);
        expect(buyer?.orderableUnits).toBe(owner?.metrics.orderableUnits);
      });
    }
  }

  it("pesanan pembeli yang belum bayar: hanya bisa batal atau kedaluwarsa, tanpa langkah pemilik", async () => {
    const target = createPublishedPreorder(A, PREFIX, stamp);
    const pending = await placeBuyer(target, 1);
    const overdue = await placeBuyer(target, 1, 1);
    if (!pending || !overdue) throw new Error("place");
    expect(nextOrderStep(await facts(pending.id))).toBeNull();
    for (const action of ["confirm", "start_production", "mark_ready", "fulfill", "mark_paid"] as const) {
      expect(await runOrderAction(A.client, pending.id, version(pending.id), action)).toEqual({ kind: "rejected", violation: "ORDER_STATE_INVALID" });
    }
    expect(await expireOrder(service, pending.id, null)).toEqual({ kind: "rejected", violation: "ORDER_STATE_INVALID" });
    expect(await cancelOrder(A.client, pending.id, version(pending.id), "Batal")).toEqual({ kind: "ok", value: undefined });
    await sleep(1300);
    expect(await expireOrder(service, overdue.id, null)).toEqual({ kind: "ok", value: undefined });
    expect(await expireOrder(service, overdue.id, null)).toEqual({ kind: "ok", value: undefined });
    expect(reservationState(overdue.id)).toBe("released");
  });
});

describe("urutan acak dengan invarian", () => {
  // Generator semu dengan benih tetap, supaya kegagalan bisa diulang persis.
  function random(seed: number) {
    let state = seed;
    return () => {
      state = (state * 1103515245 + 12345) % 2147483648;
      return state / 2147483648;
    };
  }

  const readTotals = (target: PreorderFixture) =>
    sql(`select
        (select total_units from public.production_capacity where id = '${target.capacityId}') || '|' ||
        (select coalesce(sum(quantity), 0) from public.capacity_reservations where capacity_id = '${target.capacityId}' and (state = 'allocated' or (state = 'held' and expires_at > now()))) || '|' ||
        (select coalesce(sum(quantity), 0) from public.capacity_reservations where preorder_item_id = '${target.itemId}' and (state = 'allocated' or (state = 'held' and expires_at > now()))) || '|' ||
        (select quota_units from public.preorder_items where id = '${target.itemId}')`);

  async function checkInvariants(target: PreorderFixture, step: string) {
    // Slot bertenggat 1 detik bisa lewat di antara dua pembacaan. Angka hanya dibandingkan bila database tidak berubah selama dashboard dibaca.
    let before = readTotals(target);
    let owner = await findPreorder(A.client, A.businessId, target.id);
    let buyer = await findPublicPreorder(service, target.slug);
    for (let attempt = 0; attempt < 3 && readTotals(target) !== before; attempt += 1) {
      before = readTotals(target);
      owner = await findPreorder(A.client, A.businessId, target.id);
      buyer = await findPublicPreorder(service, target.slug);
    }
    const [capacity, used, preorderUsed, quota] = before.split("|").map(Number);
    expect(used, `kapasitas terlampaui setelah ${step}`).toBeLessThanOrEqual(capacity);
    expect(preorderUsed, `kuota terlampaui setelah ${step}`).toBeLessThanOrEqual(quota);

    const anomalies = sql(`select
        (select count(*) from public.capacity_reservations reservation join public.orders customer_order on customer_order.id = reservation.order_id
          where reservation.capacity_id = '${target.capacityId}' and reservation.state = 'held' and customer_order.order_status <> 'pending_payment') || '|' ||
        (select count(*) from (select order_id from public.payments where business_id = '${A.businessId}' and applied_at is not null group by order_id having count(*) > 1) as twice) || '|' ||
        (select count(*) from public.orders customer_order where customer_order.business_id = '${A.businessId}'
          and (select count(*) from public.job_runs where job_type = 'send_paid_email' and entity_id = customer_order.id)
           <> (select count(*) from public.payments where order_id = customer_order.id and applied_at is not null)) || '|' ||
        (select count(*) from public.orders customer_order where customer_order.business_id = '${A.businessId}'
          and (customer_order.production_started_at is not null)
           <> exists (select 1 from public.order_production_costs cost join public.order_items item on item.id = cost.order_item_id where item.order_id = customer_order.id)) || '|' ||
        (select count(*) from public.orders where business_id = '${A.businessId}' and total_idr <> subtotal_idr - discount_total_idr)`);
    expect(anomalies, `anomali setelah ${step}: held tanpa menunggu bayar | dua kali diterapkan | email tidak cocok | biaya tidak cocok | total salah`).toBe("0|0|0|0|0");

    const expectedOrderable = Math.max(Math.min(capacity - used, quota - preorderUsed), 0);
    expect(owner?.metrics.orderableUnits, `dashboard tidak cocok setelah ${step}: ${JSON.stringify({ capacity, used, preorderUsed, quota, metrics: owner?.metrics })}`).toBe(expectedOrderable);
    expect(buyer?.orderableUnits, `halaman pembeli tidak cocok setelah ${step}`).toBe(buyer?.availability === "open" ? expectedOrderable : 0);
  }

  for (const seed of [7, 42, 2026]) {
    it(`benih ${seed}: 60 langkah acak tanpa satu pun invarian dilanggar`, async () => {
      const next = random(seed);
      const pick = <Item>(items: readonly Item[]): Item | undefined => items[Math.floor(next() * items.length)];
      const target = createPublishedPreorder(A, PREFIX, stamp, { quota: 8, capacity: 10 });
      const buyers: { id: string; token: string; total: number }[] = [];
      const orders: string[] = [];

      for (let step = 0; step < 60; step += 1) {
        const roll = next();
        let label: string;
        if (roll < 0.22) {
          label = "pembeli memesan";
          const order = await placeBuyer(target, 1 + Math.floor(next() * 3), next() < 0.2 ? 1 : 900);
          if (order) {
            buyers.push(order);
            orders.push(order.id);
          }
        } else if (roll < 0.34) {
          label = "pesanan manual";
          const outcome = await createManualOrder(A.client, { preorderId: target.id, idempotencyKey: crypto.randomUUID(), customerName: "M", customerEmail: null, customerContact: null, quantity: 1 + Math.floor(next() * 3), paymentStatus: next() < 0.5 ? "paid" : "unpaid" });
          if (outcome.kind === "ok") orders.push(outcome.value.orderId);
        } else if (roll < 0.42) {
          label = "pesanan manual di luar preorder";
          const outcome = await createStandaloneManualOrder(A.client, { capacityId: target.capacityId, idempotencyKey: crypto.randomUUID(), customerName: "S", customerEmail: null, customerContact: null, quantity: 1 + Math.floor(next() * 2), paymentStatus: next() < 0.5 ? "paid" : "unpaid" });
          if (outcome.kind === "ok") orders.push(outcome.value.orderId);
        } else if (roll < 0.58) {
          label = "pembayaran masuk";
          const order = pick(buyers);
          if (order) await settle(order.token, order.total).catch(() => undefined);
        } else if (roll < 0.62) {
          label = "waktu berlalu";
          await sleep(1100);
        } else if (roll < 0.68) {
          label = "kedaluwarsa dirapikan";
          const id = pick(orders);
          if (id) await expireOrder(service, id, null);
        } else if (roll < 0.78) {
          label = "pembatalan";
          const id = pick(orders);
          if (id) await cancelOrder(A.client, id, version(id), "Acak", "Catatan acak");
        } else if (roll < 0.8) {
          label = "pembayaran terlambat diterima";
          const id = pick(orders);
          const paymentId = id ? sql(`select id from public.payments where order_id = '${id}' and status = 'paid_sandbox' and applied_at is null limit 1`) : "";
          if (id && paymentId) await acceptLatePayment(A.client, id, version(id), paymentId);
        } else if (roll < 0.97) {
          label = "langkah pemilik";
          const id = pick(orders);
          const nextStep = id ? nextOrderStep(await facts(id)) : null;
          if (id && nextStep) await runOrderAction(A.client, id, version(id), nextStep.action);
        } else {
          label = "biaya dilengkapi";
          const id = pick(orders);
          if (id) await resolveProductionCost(A.client, id, version(id), { costPerUnitIdr: 1000, quality: "estimated", note: "Acak" });
        }
        await checkInvariants(target, `langkah ${step} (${label})`);
      }
    });
  }
});
