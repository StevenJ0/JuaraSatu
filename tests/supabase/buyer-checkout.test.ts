// Uji P2-3/P2-4 terhadap Supabase lokal sungguhan: checkout pembeli, QRIS, webhook, dan rekonsiliasi.
// Midtrans diganti transport tiruan yang meniru respons Sandbox. Adapter, aturan pembayaran, dan database tetap yang asli.
import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { publicOrderSchema } from "@/features/orders/schemas";
import { createPrivateOrderToken, placePublicOrder } from "@/features/orders/service";
import { createMidtransSandboxClient, sandboxQrImageUrl } from "@/features/payments/midtrans-sandbox";
import { continueQrisPayment, handleMidtransNotification } from "@/features/payments/qris-checkout.server";
import { cleanupOwners, createOwner, createPublishedPreorder, service, sleep, sql, type Owner, type PreorderFixture } from "./helpers";

const stamp = Date.now();
const PREFIX = "buy";
const config = { serverKey: "SB-Mid-server-synthetic_test_key", merchantId: "G_SYNTHETIC", acquirer: "gopay" as const };
let A: Owner;

beforeAll(async () => {
  A = await createOwner(PREFIX, "a", stamp);
});

afterAll(() => {
  cleanupOwners(PREFIX, stamp);
});

const wib = (ms: number) => new Date(ms + 7 * 3_600_000).toISOString().slice(0, 19).replace("T", " ");
type FakeTransaction = { orderId: string; txId: string; amount: number; status: "pending" | "settlement" | "expire"; expiry: string; paidAt: number | null };
const STATUS_CODES = { pending: "201", settlement: "200", expire: "407" } as const;

/** Meniru Midtrans Sandbox: POST charge dan GET status. `failCharge` mensimulasikan respons hilang setelah tagihan dibuat. */
class FakeMidtrans {
  charges = 0;
  statusCalls = 0;
  failCharge = false;
  failStatus = false;
  readonly transactions = new Map<string, FakeTransaction>();

  private payload(transaction: FakeTransaction) {
    return {
      status_code: STATUS_CODES[transaction.status], transaction_id: transaction.txId, order_id: transaction.orderId, merchant_id: config.merchantId,
      gross_amount: `${transaction.amount}.00`, currency: "IDR", payment_type: "qris", transaction_status: transaction.status, fraud_status: "accept",
      expiry_time: transaction.expiry, ...(transaction.paidAt === null ? {} : { settlement_time: wib(transaction.paidAt) }),
      actions: [{ name: "generate-qr-code", method: "GET", url: sandboxQrImageUrl(transaction.txId) }],
    };
  }

  readonly fetch = async (url: string, init: RequestInit): Promise<Response> => {
    const path = new URL(url).pathname;
    if (init.method === "POST" && path === "/v2/charge") {
      this.charges += 1;
      const body = JSON.parse(String(init.body)) as { transaction_details: { order_id: string; gross_amount: number }; custom_expiry: { order_time: string; expiry_duration: number } };
      const orderTime = Date.parse(body.custom_expiry.order_time.replace(" ", "T").replace(" +0700", "+07:00"));
      const transaction: FakeTransaction = { orderId: body.transaction_details.order_id, txId: `txn-${body.transaction_details.order_id}`,
        amount: body.transaction_details.gross_amount, status: "pending", expiry: wib(orderTime + body.custom_expiry.expiry_duration * 1000), paidAt: null };
      this.transactions.set(transaction.orderId, transaction);
      if (this.failCharge) throw new Error("respons hilang");
      return Response.json(this.payload(transaction), { status: 201 });
    }
    const match = /^\/v2\/(.+)\/status$/.exec(path);
    if (init.method === "GET" && match) {
      this.statusCalls += 1;
      if (this.failStatus) throw new Error("provider down");
      const transaction = this.transactions.get(decodeURIComponent(match[1]));
      if (!transaction) return Response.json({ status_code: "404", status_message: "Transaction doesn't exist." }, { status: 404 });
      return Response.json(this.payload(transaction), { status: 200 });
    }
    return Response.json({ status_code: "400" }, { status: 400 });
  };

  get(orderId: string): FakeTransaction {
    const transaction = this.transactions.get(orderId);
    if (!transaction) throw new Error(`transaksi ${orderId} belum ada`);
    return transaction;
  }

  settle(orderId: string): FakeTransaction {
    const transaction = this.get(orderId);
    transaction.status = "settlement";
    transaction.paidAt = Date.now();
    return transaction;
  }

  /** Notifikasi bertanda tangan seperti yang dikirim Midtrans. `grossAmount` bisa dipalsukan untuk uji. */
  notification(transaction: FakeTransaction, grossAmount = `${transaction.amount}.00`, key = config.serverKey): string {
    const statusCode = STATUS_CODES[transaction.status];
    const signature = createHash("sha512").update(`${transaction.orderId}${statusCode}${grossAmount}${key}`).digest("hex");
    return JSON.stringify({ order_id: transaction.orderId, status_code: statusCode, gross_amount: grossAmount, signature_key: signature,
      transaction_id: transaction.txId, transaction_status: transaction.status, payment_type: "qris", merchant_id: config.merchantId });
  }
}

function setup() {
  const fake = new FakeMidtrans();
  return { fake, gateway: createMidtransSandboxClient(config, { fetch: fake.fetch }) };
}

let count = 0;
async function order(target: PreorderFixture, quantity = 2, ttlSeconds = 900) {
  count += 1;
  const token = createPrivateOrderToken();
  const input = publicOrderSchema.parse({ slug: target.slug, idempotencyKey: `${PREFIX}-key-${stamp}-${count}-abcdef`, privateToken: token,
    customerName: "Pembeli", customerEmail: `${PREFIX}-buyer-${count}@example.com`, customerContact: "", quantity, expectedUnitPriceIdr: 120000 });
  const outcome = await placePublicOrder(service, input, ttlSeconds);
  if (outcome.kind !== "ok") throw new Error(`order: ${outcome.violation}`);
  return { id: outcome.value.orderId, token };
}

const providerOrderId = (orderId: string) => sql(`select provider_order_id from public.payments where order_id = '${orderId}' and is_active_attempt`);
const state = (orderId: string) => sql(`select o.order_status || '|' || coalesce(r.state, '-') || '|' ||
  (select count(*) from public.job_runs where job_type = 'send_paid_email' and entity_id = o.id) || '|' ||
  (select count(*) from public.payment_events e join public.payments p on p.id = e.payment_id where p.order_id = o.id)
  from public.orders o left join public.capacity_reservations r on r.order_id = o.id where o.id = '${orderId}'`);

describe("QRIS: membuat dan memakai ulang tagihan", () => {
  it("bayar pertama membuat satu tagihan dan QR tersimpan, membuka lagi memakai QR yang sama", async () => {
    const { fake, gateway } = setup();
    const placed = await order(createPublishedPreorder(A, PREFIX, stamp));
    const first = await continueQrisPayment(service, gateway, placed.token, { checkStatus: false });
    expect(first).toMatchObject({ kind: "qr", amountIdr: 240000 });
    const reference = providerOrderId(placed.id);
    expect(first.kind === "qr" && first.qrImageUrl).toBe(sandboxQrImageUrl(`txn-${reference}`));
    expect(sql(`select qr_content is not null and status = 'pending' from public.payments where order_id = '${placed.id}'`)).toBe("t");
    const again = await continueQrisPayment(service, gateway, placed.token, { checkStatus: false });
    expect(again.kind === "qr" && first.kind === "qr" && again.qrImageUrl === first.qrImageUrl).toBe(true);
    // Database menulis ulang format waktunya; yang dibandingkan instannya.
    expect(again.kind === "qr" && first.kind === "qr" && Date.parse(again.expiresAt ?? "") === Date.parse(first.expiresAt ?? "")).toBe(true);
    expect(fake.charges).toBe(1);
  });

  it("dua tab bersamaan hanya membuat satu tagihan", async () => {
    const { fake, gateway } = setup();
    const placed = await order(createPublishedPreorder(A, PREFIX, stamp));
    const views = await Promise.all([1, 2, 3].map(() => continueQrisPayment(service, gateway, placed.token, { checkStatus: false })));
    expect(fake.charges).toBe(1);
    expect(views.filter((view) => view.kind === "qr").length).toBeGreaterThanOrEqual(1);
    expect(views.every((view) => view.kind === "qr" || view.kind === "processing")).toBe(true);
  });

  it("respons charge hilang tidak membuat tagihan kedua, rekonsiliasi memakai referensi yang sama", async () => {
    const { fake, gateway } = setup();
    const placed = await order(createPublishedPreorder(A, PREFIX, stamp));
    fake.failCharge = true;
    expect(await continueQrisPayment(service, gateway, placed.token, { checkStatus: false })).toEqual({ kind: "provider_unavailable" });
    fake.failCharge = false;
    expect(await continueQrisPayment(service, gateway, placed.token, { checkStatus: false })).toEqual({ kind: "processing" });
    // Lewati jeda 60 detik percobaan in-flight, seolah pembeli kembali beberapa saat kemudian.
    // Trigger touch_row selalu mengisi updated_at, jadi dimatikan hanya untuk pernyataan uji ini.
    sql(`begin; set local session_replication_role = replica; update public.payments set updated_at = now() - interval '2 minutes' where order_id = '${placed.id}'; commit;`);
    const view = await continueQrisPayment(service, gateway, placed.token, { checkStatus: false });
    const reference = providerOrderId(placed.id);
    expect(view).toMatchObject({ kind: "qr", qrImageUrl: sandboxQrImageUrl(`txn-${reference}`) });
    expect(fake.charges).toBe(1);
    expect(sql(`select count(*) from public.payments where order_id = '${placed.id}'`)).toBe("1");
  });

  it("token salah dan pesanan kedaluwarsa tidak membuat tagihan", async () => {
    const { fake, gateway } = setup();
    expect(await continueQrisPayment(service, gateway, createPrivateOrderToken(), { checkStatus: false })).toEqual({ kind: "not_found" });
    const placed = await order(createPublishedPreorder(A, PREFIX, stamp), 2, 1);
    await sleep(1500);
    expect(await continueQrisPayment(service, gateway, placed.token, { checkStatus: false })).toEqual({ kind: "closed" });
    expect(fake.charges).toBe(0);
  });
});

describe("Webhook Midtrans", () => {
  it("signature salah ditolak tanpa menulis apa pun", async () => {
    const { fake, gateway } = setup();
    const placed = await order(createPublishedPreorder(A, PREFIX, stamp));
    await continueQrisPayment(service, gateway, placed.token, { checkStatus: false });
    const before = state(placed.id);
    const forged = fake.notification(fake.settle(providerOrderId(placed.id)), undefined, "SB-Mid-server-kunci_palsu");
    expect(await handleMidtransNotification(service, gateway, config, forged)).toEqual({ status: 401, body: { result: "invalid_signature" } });
    expect(await handleMidtransNotification(service, gateway, config, "bukan json")).toMatchObject({ status: 400 });
    expect(state(placed.id)).toBe(before);
    expect(fake.statusCalls).toBe(0);
  });

  it("settlement sah diterapkan sekali dengan satu email, ulangan tidak menambah efek", async () => {
    const { fake, gateway } = setup();
    const placed = await order(createPublishedPreorder(A, PREFIX, stamp));
    await continueQrisPayment(service, gateway, placed.token, { checkStatus: false });
    const body = fake.notification(fake.settle(providerOrderId(placed.id)));
    expect(await handleMidtransNotification(service, gateway, config, body)).toEqual({ status: 200, body: { result: "applied" } });
    const applied = state(placed.id);
    expect(applied).toMatch(/^awaiting_confirmation\|allocated\|1\|/);
    for (let replay = 0; replay < 3; replay += 1) {
      expect(await handleMidtransNotification(service, gateway, config, body)).toEqual({ status: 200, body: { result: "duplicate" } });
    }
    expect(state(placed.id)).toBe(applied);
    expect(await continueQrisPayment(service, gateway, placed.token, { checkStatus: false })).toEqual({ kind: "paid" });
    expect(fake.charges).toBe(1);
  });

  it("nominal notifikasi berbeda dari status provider ditolak tanpa menulis", async () => {
    const { fake, gateway } = setup();
    const placed = await order(createPublishedPreorder(A, PREFIX, stamp));
    await continueQrisPayment(service, gateway, placed.token, { checkStatus: false });
    const before = state(placed.id);
    // Signature dibuat untuk nominal palsu: sah secara tanda tangan, tapi GET Status membuktikan nominal aslinya berbeda.
    const body = fake.notification(fake.settle(providerOrderId(placed.id)), "1000.00");
    expect(await handleMidtransNotification(service, gateway, config, body)).toEqual({ status: 400, body: { result: "mismatch" } });
    expect(state(placed.id)).toBe(before);
  });

  it("status provider tidak bisa dihubungi memberi 503 agar Midtrans mengulang, tanpa menulis", async () => {
    const { fake, gateway } = setup();
    const placed = await order(createPublishedPreorder(A, PREFIX, stamp));
    await continueQrisPayment(service, gateway, placed.token, { checkStatus: false });
    const before = state(placed.id);
    fake.failStatus = true;
    const body = fake.notification(fake.settle(providerOrderId(placed.id)));
    expect(await handleMidtransNotification(service, gateway, config, body)).toEqual({ status: 503, body: { result: "retry" } });
    expect(state(placed.id)).toBe(before);
    fake.failStatus = false;
    expect(await handleMidtransNotification(service, gateway, config, body)).toEqual({ status: 200, body: { result: "applied" } });
  });

  it("notifikasi untuk referensi yang bukan milik aplikasi tidak menulis apa pun", async () => {
    const { fake, gateway } = setup();
    fake.transactions.set("CL-BUKANMILIK-1", { orderId: "CL-BUKANMILIK-1", txId: "txn-asing", amount: 240000, status: "settlement", expiry: wib(Date.now() + 600_000), paidAt: Date.now() });
    const body = fake.notification(fake.get("CL-BUKANMILIK-1"));
    expect(await handleMidtransNotification(service, gateway, config, body)).toEqual({ status: 404, body: { result: "not_found" } });
  });

  it("expire dari provider tidak mengalokasikan slot", async () => {
    const { fake, gateway } = setup();
    const placed = await order(createPublishedPreorder(A, PREFIX, stamp));
    await continueQrisPayment(service, gateway, placed.token, { checkStatus: false });
    const transaction = fake.get(providerOrderId(placed.id));
    transaction.status = "expire";
    const result = await handleMidtransNotification(service, gateway, config, fake.notification(transaction));
    expect(result.status).toBe(200);
    expect(sql(`select status from public.payments where order_id = '${placed.id}'`)).toBe("expired");
    expect(state(placed.id)).toMatch(/^pending_payment\|held\|0\|/);
  });
});

describe("Cek status oleh pembeli", () => {
  it("settlement tanpa webhook diterapkan lewat tombol cek status, hasilnya sama dengan webhook", async () => {
    const { fake, gateway } = setup();
    const placed = await order(createPublishedPreorder(A, PREFIX, stamp));
    await continueQrisPayment(service, gateway, placed.token, { checkStatus: false });
    const transaction = fake.settle(providerOrderId(placed.id));
    expect(await continueQrisPayment(service, gateway, placed.token, { checkStatus: true })).toEqual({ kind: "updated" });
    expect(state(placed.id)).toMatch(/^awaiting_confirmation\|allocated\|1\|/);
    // Webhook yang datang belakangan untuk fakta yang sama tercatat duplicate, bukan pembayaran kedua.
    expect(await handleMidtransNotification(service, gateway, config, fake.notification(transaction))).toEqual({ status: 200, body: { result: "duplicate" } });
    expect(sql(`select count(*) from public.job_runs where job_type = 'send_paid_email' and entity_id = '${placed.id}'`)).toBe("1");
  });
});
