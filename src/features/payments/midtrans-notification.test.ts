import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createMidtransSandboxClient, sandboxQrImageUrl, verifyMidtransNotification } from "./midtrans-sandbox";

const config = { serverKey: "SB-Mid-server-synthetic_test_key", merchantId: "G_SYNTHETIC", acquirer: "gopay" as const };

function signed(changes: Record<string, string> = {}, key = config.serverKey) {
  const body = { order_id: "CL-ABCDEF1234-1", status_code: "200", gross_amount: "216000.00", transaction_id: "txn-1", transaction_status: "settlement", ...changes };
  const signature_key = createHash("sha512").update(`${body.order_id}${body.status_code}${body.gross_amount}${key}`).digest("hex");
  return { ...body, signature_key };
}

describe("verifyMidtransNotification", () => {
  it("menerima signature SHA-512 yang sah dan mengembalikan fakta minimal", () => {
    expect(verifyMidtransNotification(config, signed())).toEqual({
      providerOrderId: "CL-ABCDEF1234-1", providerTransactionId: "txn-1", providerStatus: "settlement", amountIdr: 216000,
    });
  });

  it("menolak signature dari server key lain", () => {
    expect(verifyMidtransNotification(config, signed({}, "SB-Mid-server-kunci_lain"))).toBeNull();
  });

  it.each([
    ["nominal diubah setelah ditandatangani", { gross_amount: "1.00" }],
    ["order diubah setelah ditandatangani", { order_id: "CL-LAIN000000-1" }],
    ["status_code diubah setelah ditandatangani", { status_code: "201" }],
  ])("menolak %s", (_label, changes) => {
    expect(verifyMidtransNotification(config, { ...signed(), ...changes })).toBeNull();
  });

  it.each([null, "teks", {}, { ...signed(), signature_key: "bukan-hex" }, { ...signed(), gross_amount: 216000 }])("menolak bentuk tidak dikenal %#", (payload) => {
    expect(verifyMidtransNotification(config, payload)).toBeNull();
  });

  it("menolak nominal pecahan walau signature sah", () => {
    expect(verifyMidtransNotification(config, signed({ gross_amount: "216000.50" }))).toBeNull();
  });
});

describe("sandboxQrImageUrl", () => {
  it("hanya mengarah ke host Sandbox dan meng-encode ID transaksi", () => {
    expect(sandboxQrImageUrl("txn-1")).toBe("https://api.sandbox.midtrans.com/v2/qris/txn-1/qr-code");
    expect(new URL(sandboxQrImageUrl("../../v2/charge?x=1")).origin).toBe("https://api.sandbox.midtrans.com");
    expect(sandboxQrImageUrl("../../v2/charge?x=1")).toContain("%3Fx%3D1");
  });
});

describe("GET Status transaksi kedaluwarsa", () => {
  const status = (changes: Record<string, string>) => ({
    status_code: "407", transaction_id: "txn-1", order_id: "CL-ABCDEF1234-1", merchant_id: config.merchantId, gross_amount: "216000.00",
    currency: "IDR", payment_type: "qris", transaction_status: "expire", ...changes,
  });
  const client = (payload: unknown) => createMidtransSandboxClient(config, { fetch: vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 })) });

  it("kode 407 dengan status expire dibaca sebagai fakta status", async () => {
    await expect(client(status({})).getStatus({ providerOrderId: "CL-ABCDEF1234-1", amountIdr: 216000 })).resolves.toMatchObject({
      kind: "found", transaction: { providerStatus: "expire", providerStatusCode: "407" },
    });
  });

  it("kode 407 dengan status lain tetap ditolak", async () => {
    await expect(client(status({ transaction_status: "settlement" })).getStatus({ providerOrderId: "CL-ABCDEF1234-1", amountIdr: 216000 })).rejects.toMatchObject({ code: "PROVIDER_REJECTED" });
  });
});
