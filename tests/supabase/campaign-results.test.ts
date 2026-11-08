// Uji P3-1 terhadap Supabase lokal sungguhan: hasil kampanye dari pembayaran Sandbox terverifikasi, lewat client pemilik (RLS).
// Kampanye terbit dibuat lewat SQL seperti uji C8. Pembayaran memakai jalur webhook asli dengan transport Midtrans tiruan.
import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listPreorderCampaignResults } from "@/features/campaign-results/repository";
import { publicOrderSchema } from "@/features/orders/schemas";
import { createManualOrder, createPrivateOrderToken, placePublicOrder } from "@/features/orders/service";
import { createMidtransSandboxClient, sandboxQrImageUrl } from "@/features/payments/midtrans-sandbox";
import { continueQrisPayment, handleMidtransNotification } from "@/features/payments/qris-checkout.server";
import { cleanupOwners, createOwner, createPublishedPreorder, service, sql, type Owner, type PreorderFixture } from "./helpers";

const stamp = Date.now();
const PREFIX = "p31";
const config = { serverKey: "SB-Mid-server-synthetic_test_key", merchantId: "G_SYNTHETIC", acquirer: "gopay" as const };
let A: Owner;
let B: Owner;
let target: PreorderFixture;
let campaignId: string;
let campaignSlug: string;

const wib = (ms: number) => new Date(ms + 7 * 3_600_000).toISOString().slice(0, 19).replace("T", " ");
const transactions = new Map<string, { status: "pending" | "settlement"; amount: number; expiry: string }>();
const gateway = createMidtransSandboxClient(config, {
  fetch: async (url: string, init: RequestInit) => {
    const path = new URL(url).pathname;
    const reply = (orderId: string) => {
      const transaction = transactions.get(orderId);
      if (!transaction) return Response.json({ status_code: "404" }, { status: 404 });
      return Response.json({ status_code: transaction.status === "settlement" ? "200" : "201", transaction_id: `txn-${orderId}`, order_id: orderId,
        merchant_id: config.merchantId, gross_amount: `${transaction.amount}.00`, currency: "IDR", payment_type: "qris", transaction_status: transaction.status,
        fraud_status: "accept", expiry_time: transaction.expiry, ...(transaction.status === "settlement" ? { settlement_time: wib(Date.now()) } : {}),
        actions: [{ name: "generate-qr-code", method: "GET", url: sandboxQrImageUrl(`txn-${orderId}`) }] }, { status: 200 });
    };
    if (init.method === "POST") {
      const body = JSON.parse(String(init.body)) as { transaction_details: { order_id: string; gross_amount: number }; custom_expiry: { order_time: string; expiry_duration: number } };
      const orderTime = Date.parse(body.custom_expiry.order_time.replace(" ", "T").replace(" +0700", "+07:00"));
      transactions.set(body.transaction_details.order_id, { status: "pending", amount: body.transaction_details.gross_amount, expiry: wib(orderTime + body.custom_expiry.expiry_duration * 1000) });
      return reply(body.transaction_details.order_id);
    }
    return reply(decodeURIComponent(/^\/v2\/(.+)\/status$/.exec(path)?.[1] ?? ""));
  },
});

let count = 0;
async function buy(quantity: number, attributionRef: string | null, { pay }: { pay: boolean }) {
  count += 1;
  const token = createPrivateOrderToken();
  const outcome = await placePublicOrder(service, publicOrderSchema.parse({ slug: target.slug, idempotencyKey: `${PREFIX}-key-${stamp}-${count}-abcdef`, privateToken: token,
    customerName: "Pembeli", customerEmail: `${PREFIX}-buyer-${count}@example.com`, customerContact: "", quantity, expectedUnitPriceIdr: 108000, attributionRef }), 900);
  if (outcome.kind !== "ok") throw new Error(`order: ${outcome.violation}`);
  if (!pay) return outcome.value.orderId;
  await continueQrisPayment(service, gateway, token, { checkStatus: false });
  const reference = sql(`select provider_order_id from public.payments where order_id = '${outcome.value.orderId}'`);
  const transaction = transactions.get(reference);
  if (!transaction) throw new Error("charge tidak dibuat");
  transaction.status = "settlement";
  const gross = `${transaction.amount}.00`;
  const body = JSON.stringify({ order_id: reference, status_code: "200", gross_amount: gross, transaction_id: `txn-${reference}`, transaction_status: "settlement",
    signature_key: createHash("sha512").update(`${reference}200${gross}${config.serverKey}`).digest("hex") });
  const result = await handleMidtransNotification(service, gateway, config, body);
  if (result.body.result !== "applied") throw new Error(`apply: ${result.body.result}`);
  return outcome.value.orderId;
}

beforeAll(async () => {
  A = await createOwner(PREFIX, "a", stamp);
  B = await createOwner(PREFIX, "b", stamp);
  target = createPublishedPreorder(A, PREFIX, stamp, { quota: 30, capacity: 40 });
  campaignSlug = `${PREFIX}-promo-${stamp}`;
  campaignId = sql(`begin;
    set local session_replication_role = replica;
    with blueprint as (select gen_random_uuid() as id)
    insert into public.campaigns (business_id, preorder_id, name, slug, status, offer_type, marketing_approach, discount_bps, budget_cap_idr,
      primary_kpi, target_additional_units, starts_at, ends_at, published_at, active_blueprint_id, published_blueprint_id,
      baseline_json, baseline_calculated_at, metrics_schema_version, costs_completeness)
    select '${A.businessId}', '${target.id}', 'Promo Uji', '${campaignSlug}', 'published', 'percent_discount', 'limited_discount', 1000, 50000,
      'paid_units_in_window', 6, now() - interval '1 hour', now() + interval '2 days', now() - interval '1 hour',
      blueprint.id, blueprint.id, '{}'::jsonb, now(), 1, 'unreviewed'
    from blueprint returning id;
    commit;`);
  await buy(2, campaignSlug, { pay: true });
  await buy(1, null, { pay: true });
  await buy(3, campaignSlug, { pay: false });
  const manual = await createManualOrder(A.client, { preorderId: target.id, idempotencyKey: crypto.randomUUID(), customerName: "Manual", customerEmail: null,
    customerContact: null, quantity: 1, paymentStatus: "paid" });
  if (manual.kind !== "ok") throw new Error(`manual: ${manual.violation}`);
});

afterAll(() => {
  cleanupOwners(PREFIX, stamp);
});

describe("hasil kampanye dari database sungguhan", () => {
  it("hanya pembayaran Sandbox yang diterapkan dihitung, dengan subset tautan dan promo", async () => {
    const [result] = await listPreorderCampaignResults(A.client, A.businessId, target.id);
    expect(result.campaign).toMatchObject({ id: campaignId, slug: campaignSlug, targetAdditionalUnits: 6, offerType: "percent_discount" });
    expect(result.phase).toBe("running");
    expect(result.verified).toEqual({ orders: 2, units: 3, valueIdr: BigInt(324000) });
    expect(result.attributed).toEqual({ orders: 1, units: 2, valueIdr: BigInt(216000) });
    expect(result.discounted).toEqual({ orders: 2, discountGivenIdr: BigInt(36000) });
  });

  it("pesanan manual lunas dihitung terpisah, harga manual tetap harga dasar", async () => {
    const [result] = await listPreorderCampaignResults(A.client, A.businessId, target.id);
    expect(result.manual).toEqual({ orders: 1, units: 1, valueIdr: BigInt(120000) });
  });

  it("pemilik usaha lain tidak melihat kampanye atau pesanan usaha ini", async () => {
    expect(await listPreorderCampaignResults(B.client, A.businessId, target.id)).toEqual([]);
    expect(await listPreorderCampaignResults(B.client, B.businessId, target.id)).toEqual([]);
  });

  it("kampanye yang ditutup lebih awal tidak menghitung pembayaran setelah ditutup", async () => {
    sql(`begin; set local session_replication_role = replica; update public.campaigns set status = 'closed', closed_at = now() - interval '30 minutes' where id = '${campaignId}'; commit;`);
    const [result] = await listPreorderCampaignResults(A.client, A.businessId, target.id);
    expect(result.phase).toBe("ended");
    expect(result.verified.orders).toBe(0);
  });
});
