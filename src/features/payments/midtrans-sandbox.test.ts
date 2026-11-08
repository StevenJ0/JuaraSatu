import { describe, expect, it, vi } from "vitest";
import {
  createMidtransSandboxClient,
  MidtransSandboxError,
  parseMidtransSandboxConfig,
} from "./midtrans-sandbox";

const config = { serverKey: "SB-Mid-server-synthetic_test_key", merchantId: "G_SYNTHETIC", acquirer: "gopay" };
const now = Date.parse("2026-11-05T03:00:00.000Z");
const expected = { providerOrderId: "cl-spike-synthetic-1", amountIdr: 216_000 };
const input = { ...expected, paymentDueAt: "2026-11-05T03:15:00.000Z" };
type FakeFetch = (url: string, init: RequestInit) => Promise<Response>;

function fixture(changes: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    status_code: "201",
    transaction_id: "txn-synthetic-1",
    order_id: expected.providerOrderId,
    merchant_id: config.merchantId,
    gross_amount: "216000.00",
    currency: "IDR",
    payment_type: "qris",
    transaction_status: "pending",
    fraud_status: "accept",
    expiry_time: "2026-11-05 10:15:00",
    actions: [{ name: "generate-qr-code", method: "GET", url: "https://api.sandbox.midtrans.com/v2/qris/txn-synthetic-1/qr-code" }],
    ...changes,
  };
}

function setup(payload: unknown = fixture(), httpStatus = 201) {
  const fetcher = vi.fn<FakeFetch>(async () => new Response(JSON.stringify(payload), { status: httpStatus }));
  const client = createMidtransSandboxClient(config, { fetch: fetcher, now: () => now });
  return { client, fetcher };
}

describe("konfigurasi Midtrans Sandbox", () => {
  it("memakai acquirer default tanpa mengaktifkan production", () => {
    expect(parseMidtransSandboxConfig({ MIDTRANS_SERVER_KEY: config.serverKey, MIDTRANS_MERCHANT_ID: config.merchantId }))
      .toEqual(config);
  });

  it.each([undefined, "", "Mid-server-synthetic_production", "SB-Mid-server-test\nInjected"])("menolak key tidak sah tanpa mengulang nilainya (%s)", (key) => {
    try {
      parseMidtransSandboxConfig({ MIDTRANS_SERVER_KEY: key, MIDTRANS_MERCHANT_ID: config.merchantId });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(MidtransSandboxError);
      expect(error).toMatchObject({ code: "INVALID_CONFIGURATION", reconciliationRequired: false });
      expect(String(error)).not.toContain("synthetic_production");
      expect(String(error)).not.toContain("Injected");
    }
  });

  it("menolak merchant/acquirer kosong atau tak dikenal", () => {
    expect(() => parseMidtransSandboxConfig({ MIDTRANS_SERVER_KEY: config.serverKey })).toThrow(MidtransSandboxError);
    expect(() => createMidtransSandboxClient({ ...config, acquirer: "untrusted" })).toThrow(MidtransSandboxError);
  });

  it("mendukung acquirer QRIS kedua yang terdokumentasi", () => {
    expect(parseMidtransSandboxConfig({ MIDTRANS_SERVER_KEY: config.serverKey, MIDTRANS_MERCHANT_ID: config.merchantId, MIDTRANS_QRIS_ACQUIRER: "airpay shopee" }).acquirer).toBe("airpay shopee");
  });

  it.each([0, -1, 1.5, Infinity, 30_001])("membatasi timeout konfigurasi (%s)", (timeoutMs) => {
    expect(() => createMidtransSandboxClient(config, { timeoutMs })).toThrow(MidtransSandboxError);
  });
});

describe("createQris: batas adapter tanpa database", () => {
  it("mengirim nominal, reference, dan deadline server; hasil aman tanpa secret/PII", async () => {
    const { client, fetcher } = setup();
    const result = await client.createQris(input);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, request] = fetcher.mock.calls[0];
    expect(url).toBe("https://api.sandbox.midtrans.com/v2/charge");
    expect(request).toMatchObject({ method: "POST", cache: "no-store", redirect: "error" });
    expect(request.signal).toBeInstanceOf(AbortSignal);
    expect(new Headers(request.headers).get("Authorization")).toBe(`Basic ${Buffer.from(`${config.serverKey}:`).toString("base64")}`);
    expect(JSON.parse(String(request.body))).toEqual({
      payment_type: "qris", qris: { acquirer: "gopay" },
      transaction_details: { order_id: expected.providerOrderId, gross_amount: 216_000 },
      custom_expiry: { order_time: "2026-11-05 10:00:00 +0700", expiry_duration: 900, unit: "second" },
    });
    expect(result).toMatchObject({ ...expected, providerStatus: "pending", expiresAt: input.paymentDueAt, expiryConfirmed: true });
    expect(result.providerPaidAt).toBeNull();
    expect(JSON.stringify(result)).not.toContain(config.serverKey);
  });

  it("mengurangi durasi saat memulai lebih lambat tanpa memperpanjang hold saat retry", async () => {
    const fetcher = vi.fn<FakeFetch>(async () => new Response(JSON.stringify(fixture()), { status: 201 }));
    const client = createMidtransSandboxClient(config, { fetch: fetcher, now: () => now + 120_500 });
    await client.createQris(input);
    const requestBody = JSON.parse(String(fetcher.mock.calls[0][1].body));
    expect(requestBody.custom_expiry).toEqual({ order_time: "2026-11-05 10:02:00 +0700", expiry_duration: 780, unit: "second" });
  });

  it.each(["216000", 0, -1, 216_000.5, Infinity, Number.MAX_SAFE_INTEGER + 1, null])("menolak nominal invalid tanpa HTTP (%s)", async (amountIdr) => {
    const { client, fetcher } = setup();
    await expect(client.createQris({ ...input, amountIdr })).rejects.toMatchObject({ code: "INVALID_REQUEST", reconciliationRequired: false });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each(["../other/status", "unsafe?x=1", "", "a".repeat(51)])("menolak reference/path yang tidak sah (%s)", async (providerOrderId) => {
    const { client, fetcher } = setup();
    await expect(client.createQris({ ...input, providerOrderId })).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each(["2026-11-05T03:00:00Z", "2026-11-05T03:00:00.500Z", "2026-11-07T03:00:00Z", "2026-11-05 10:15:00", "invalid"])("menolak deadline usang/tanpa offset/terlalu jauh (%s)", async (paymentDueAt) => {
    const { client, fetcher } = setup();
    await expect(client.createQris({ ...input, paymentDueAt })).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    { expiry_time: undefined },
    { expiry_time: "2026-11-05 10:16:00" },
    { expiry_time: "2026-11-05 10:00:00" },
  ])("tidak menyajikan QR dengan expiry yang belum aman (%j)", async (changes) => {
    const { client, fetcher } = setup(fixture(changes));
    await expect(client.createQris(input)).rejects.toMatchObject({ code: "EXPIRY_UNCONFIRMED", reconciliationRequired: true });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([
    "https://api.midtrans.com/v2/qris/txn-synthetic-1/qr-code",
    "https://attacker.example/qr-code",
    "http://api.sandbox.midtrans.com/v2/qris/txn-synthetic-1/qr-code",
    "https://api.sandbox.midtrans.com/v2/qris/other/qr-code",
    "https://api.sandbox.midtrans.com/v2/qris/txn-synthetic-1/qr-code?redirect=unsafe",
    "https://user:password@api.sandbox.midtrans.com/v2/qris/txn-synthetic-1/qr-code",
    "not a URL",
  ])("menolak URL QR yang tidak cocok dengan transaksi Sandbox (%s)", async (url) => {
    const { client } = setup(fixture({ actions: [{ name: "generate-qr-code", method: "GET", url }] }));
    await expect(client.createQris(input)).rejects.toMatchObject({ code: "INVALID_PROVIDER_RESPONSE", reconciliationRequired: true });
  });

  it("menolak response tanpa action QR asli, bukan membuat QR palsu", async () => {
    const { client } = setup(fixture({ actions: [] }));
    await expect(client.createQris(input)).rejects.toMatchObject({ code: "INVALID_PROVIDER_RESPONSE" });
  });

  it("tidak membuat QR pending dari settlement atau fraud yang tidak accepted", async () => {
    for (const changes of [{ transaction_status: "settlement" }, { fraud_status: "deny" }]) {
      const { client } = setup(fixture(changes));
      await expect(client.createQris(input)).rejects.toMatchObject({ code: "PROVIDER_REJECTED", reconciliationRequired: true });
    }
  });
});

describe("validasi fakta provider dan pembacaan status", () => {
  it.each([
    [{ order_id: "other-order" }, "REFERENCE_MISMATCH"],
    [{ merchant_id: "OTHER_MERCHANT" }, "REFERENCE_MISMATCH"],
    [{ gross_amount: "1.00" }, "AMOUNT_MISMATCH"],
    [{ gross_amount: "216000.50" }, "INVALID_PROVIDER_RESPONSE"],
    [{ gross_amount: "2.16e5" }, "INVALID_PROVIDER_RESPONSE"],
    [{ gross_amount: "216000x" }, "INVALID_PROVIDER_RESPONSE"],
    [{ gross_amount: "9007199254740993.00" }, "INVALID_PROVIDER_RESPONSE"],
    [{ payment_type: "credit_card" }, "INVALID_PROVIDER_RESPONSE"],
    [{ currency: "USD" }, "INVALID_PROVIDER_RESPONSE"],
    [{ expiry_time: "2026-02-30 10:00:00" }, "INVALID_PROVIDER_RESPONSE"],
    [{ status_code: "409" }, "PROVIDER_REJECTED"],
  ])("menolak response tidak cocok atau malformed (%j)", async (changes, code) => {
    const { client } = setup(fixture(changes), 200);
    await expect(client.getStatus(expected)).rejects.toMatchObject({ code, reconciliationRequired: false });
  });

  it("GET status membaca fakta settlement, tidak menulis order atau membuat charge", async () => {
    const { client, fetcher } = setup(fixture({ transaction_status: "settlement", status_code: "200", settlement_time: "2026-11-05 10:04:03" }), 200);
    const result = await client.getStatus(expected);
    expect(fetcher.mock.calls[0][0]).toBe(`https://api.sandbox.midtrans.com/v2/${expected.providerOrderId}/status`);
    expect(fetcher.mock.calls[0][1]).toMatchObject({ method: "GET", body: undefined, cache: "no-store" });
    expect(result).toMatchObject({ kind: "found", transaction: { providerStatus: "settlement", providerPaidAt: "2026-11-05T03:04:03.000Z" } });
  });

  it("tidak mengarang paidAt jika provider tidak memberikannya", async () => {
    const { client } = setup(fixture({ transaction_status: "settlement", status_code: "200" }), 200);
    expect(await client.getStatus(expected)).toMatchObject({ kind: "found", transaction: { providerPaidAt: null } });
  });

  it.each(["pending", "settlement", "expire", "deny", "cancel", "refund", "partial_refund"])("mempertahankan status provider untuk consumer (%s)", async (transaction_status) => {
    const { client } = setup(fixture({ transaction_status }), 200);
    expect(await client.getStatus(expected)).toMatchObject({ kind: "found", transaction: { providerStatus: transaction_status } });
  });

  it("mencocokkan transaction ID jika attempt sudah memilikinya", async () => {
    const { client } = setup();
    await expect(client.getStatus({ ...expected, providerTransactionId: "other-txn" })).rejects.toMatchObject({ code: "REFERENCE_MISMATCH" });
  });

  it("mengizinkan field baru provider tanpa mengekspornya ke DTO", async () => {
    const { client } = setup(fixture({ future_field: true, customer_email: "synthetic@example.test", signature_key: "synthetic-signature" }), 200);
    const result = await client.getStatus(expected);
    expect(result.kind).toBe("found");
    expect(JSON.stringify(result)).not.toContain("customer_email");
    expect(JSON.stringify(result)).not.toContain("signature_key");
  });

  it("404 tidak memicu retry/create attempt", async () => {
    const { client, fetcher } = setup({ status_code: "404", status_message: "Transaction doesn't exist" }, 404);
    expect(await client.getStatus(expected)).toEqual({ kind: "not_found" });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][1].method).toBe("GET");
  });

  it("status request invalid ditolak sebelum HTTP", async () => {
    const { client, fetcher } = setup();
    await expect(client.getStatus({ ...expected, amountIdr: "216000" })).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("timeout, kegagalan, dan privasi", () => {
  it("network failure pada POST ambigu dan tidak dicoba ulang otomatis", async () => {
    const fetcher = vi.fn(async () => { throw new Error(`unsafe provider error ${config.serverKey}`); });
    const client = createMidtransSandboxClient(config, { fetch: fetcher, now: () => now });
    try {
      await client.createQris(input);
      expect.unreachable();
    } catch (error) {
      expect(error).toMatchObject({ code: "PROVIDER_UNAVAILABLE", reconciliationRequired: true });
      expect(JSON.stringify(error)).not.toContain(config.serverKey);
      expect(String(error)).not.toContain(config.serverKey);
      expect(error).not.toHaveProperty("cause");
    }
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("timeout membatalkan request dan menuntut reconcile, tanpa blind retry", async () => {
    vi.useFakeTimers();
    try {
      const fetcher = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new Error("synthetic abort")), { once: true });
      }));
      const client = createMidtransSandboxClient(config, { fetch: fetcher, now: () => now, timeoutMs: 100 });
      const assertion = expect(client.createQris(input)).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE", reconciliationRequired: true });
      await vi.advanceTimersByTimeAsync(100);
      await assertion;
      expect(fetcher).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([401, 406, 429, 500, 503])("HTTP error charge tetap butuh reconcile (%s)", async (status) => {
    const { client, fetcher } = setup({ status_code: String(status), status_message: "synthetic failure" }, status);
    await expect(client.createQris(input)).rejects.toMatchObject({ code: "PROVIDER_REJECTED", reconciliationRequired: true });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("response HTML tidak bocor lewat pesan error", async () => {
    const fetcher = vi.fn(async () => new Response(`<html>${config.serverKey}</html>`, { status: 502 }));
    const client = createMidtransSandboxClient(config, { fetch: fetcher, now: () => now });
    await expect(client.createQris(input)).rejects.toMatchObject({ code: "INVALID_PROVIDER_RESPONSE", reconciliationRequired: true });
  });

  it("membatasi ukuran response provider", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ payload: "x".repeat(70_000) })));
    const client = createMidtransSandboxClient(config, { fetch: fetcher, now: () => now });
    await expect(client.createQris(input)).rejects.toMatchObject({ code: "INVALID_PROVIDER_RESPONSE", reconciliationRequired: true });
  });
});
