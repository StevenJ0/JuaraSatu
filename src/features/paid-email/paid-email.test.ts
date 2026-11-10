import { describe, expect, it, vi } from "vitest";
import { EmailSendError, createMailpitSender, createResendSender, loadEmailSender } from "@/features/paid-email/sender.server";
import { buildOwnerPaidOrderEmail, buildPaidEmail, buildPendingPaymentEmail, type OrderEmailFacts, type PaidEmailFacts } from "@/features/paid-email/template";

const facts: PaidEmailFacts = {
  orderId: "7d6f1b3a-0000-4000-8000-000000000001",
  publicOrderNumber: "CL-ABCDEF1234",
  customerName: "Sari <b>Wulandari</b>",
  customerEmail: "sari@example.com",
  businessName: "Kaos Juara",
  preorderName: "Preorder November",
  productName: "Kaos Hitam",
  sku: "KJ-1",
  quantity: 2,
  baseUnitPriceIdr: 120000,
  discountPerUnitIdr: 12000,
  finalUnitPriceIdr: 108000,
  subtotalIdr: 240000,
  discountTotalIdr: 24000,
  totalIdr: 216000,
  fulfillmentDate: "2026-11-22",
  fulfillmentWindowEndAt: "2026-11-22T10:00:00.000Z",
  pickupInstructions: "Ambil di toko\nSabtu 10.00",
  publicContact: "WA 0812",
};

describe("buildPaidEmail", () => {
  it("memuat rincian wajib FR-EMAIL-01 dan label simulasi", () => {
    const email = buildPaidEmail(facts);
    expect(email.to).toBe("sari@example.com");
    expect(email.subject).toBe("Pembayaran diterima! Pesanan CL-ABCDEF1234 siap diproses (simulasi Sandbox)");
    for (const part of ["CL-ABCDEF1234", "Kaos Juara", "Kaos Hitam (SKU KJ-1)", "2 unit", "Rp120.000", "Rp12.000", "Rp108.000", "Rp24.000", "Rp216.000", "WA 0812", "simulasi pembayaran Midtrans Sandbox"]) {
      expect(email.text).toContain(part);
    }
  });

  it("tanpa diskon tidak menampilkan baris diskon", () => {
    const email = buildPaidEmail({ ...facts, discountPerUnitIdr: 0, finalUnitPriceIdr: 120000, discountTotalIdr: 0, subtotalIdr: 240000, totalIdr: 240000 });
    expect(email.text).not.toContain("Diskon per unit");
    expect(email.text).not.toContain("Total diskon");
  });

  it("isi dari pembeli atau pemilik di-escape di HTML", () => {
    const email = buildPaidEmail({ ...facts, businessName: `Kaos "Juara" & <script>` });
    expect(email.html).not.toContain("<b>Wulandari</b>");
    expect(email.html).not.toContain("<script>");
    expect(email.html).toContain("Sari &lt;b&gt;Wulandari&lt;/b&gt;");
    expect(email.html).toContain("Kaos &quot;Juara&quot; &amp; &lt;script&gt;");
  });

  it("subjek dan sapaan tidak bisa disisipi baris baru", () => {
    const email = buildPaidEmail({ ...facts, customerName: "Sari\r\nBcc: lain@example.com", publicOrderNumber: "CL-1\nX" });
    expect(email.subject).not.toMatch(/[\r\n]/);
    expect(email.text.split("\n")[0]).toBe("Terima kasih, Sari Bcc: lain@example.com! Pembayaranmu sudah kami terima");
  });

  it("tanpa token di memori tidak ada tautan pesanan; dengan token tautannya menjadi tombol", () => {
    const email = buildPaidEmail(facts);
    expect(email.html).not.toMatch(/href=|\/o\//);
    expect(email.text).not.toContain("/o/");
    const linked = buildPaidEmail(facts, { orderUrl: "http://localhost:3001/o/tok-123", logoUrl: "http://localhost:3001/logo%20full.png" });
    expect(linked.html).toContain('href="http://localhost:3001/o/tok-123"');
    expect(linked.html).toContain('src="http://localhost:3001/logo%20full.png"');
    expect(linked.text).toContain("Lihat status pesanan: http://localhost:3001/o/tok-123");
    expect(linked.text).toContain("Jangan dibagikan");
  });
});

const orderFacts: OrderEmailFacts = { ...facts, customerContact: "WA 0813", paymentDueAt: "2026-11-20T08:15:00.000Z" };

describe("buildPendingPaymentEmail", () => {
  it("mengajak membayar sebelum tenggat dengan tombol ke halaman pesanan", () => {
    const email = buildPendingPaymentEmail(orderFacts, { orderUrl: "http://localhost:3001/o/tok-123" });
    expect(email.to).toBe("sari@example.com");
    expect(email.subject).toBe("Satu langkah lagi: bayar pesanan CL-ABCDEF1234 di Kaos Juara");
    for (const part of ["CL-ABCDEF1234", "Kaos Hitam (SKU KJ-1)", "Rp216.000", "Bayar sebelum", "Bayar sekarang: http://localhost:3001/o/tok-123", "Midtrans Sandbox"]) {
      expect(email.text).toContain(part);
    }
    expect(email.html).toContain("Menunggu pembayaran");
    expect(email.html).not.toContain("<b>Wulandari</b>");
  });

  it("tanpa tautan memberi petunjuk membuka halaman dari perangkat yang sama", () => {
    const email = buildPendingPaymentEmail(orderFacts);
    expect(email.html).not.toContain("href=");
    expect(email.text).toContain("perangkat tempat kamu memesan");
  });
});

describe("buildOwnerPaidOrderEmail", () => {
  it("memberi tahu penjual siapa membeli, apa, berapa, dan kapan diambil", () => {
    const email = buildOwnerPaidOrderEmail(orderFacts, "pemilik@example.com", { dashboardUrl: "http://localhost:3001/dashboard/orders/abc" });
    expect(email.to).toBe("pemilik@example.com");
    expect(email.subject).toBe("Order baru lunas: CL-ABCDEF1234, Kaos Hitam x2");
    for (const part of ["WA 0813", "sari@example.com", "Rp216.000", "Buka pesanan di dashboard: http://localhost:3001/dashboard/orders/abc"]) {
      expect(email.text).toContain(part);
    }
    expect(email.html).toContain("Order masuk");
  });
});

type FakeFetch = (url: string, init: RequestInit) => Promise<Response>;

describe("pengirim email", () => {
  const message = buildPaidEmail(facts);

  it("Resend: kunci idempotensi, otorisasi, dan id provider", async () => {
    const fetcher = vi.fn<FakeFetch>(async () => Response.json({ id: "re_123" }));
    const sender = createResendSender("re_test_key_123", "juarasatu <noreply@example.com>", fetcher);
    await expect(sender.send(message, "order-1:paid-v1")).resolves.toEqual({ providerReference: "re_123" });
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.headers).toMatchObject({ Authorization: "Bearer re_test_key_123", "Idempotency-Key": "order-1:paid-v1" });
    expect(JSON.parse(String(init.body))).toMatchObject({ from: "juarasatu <noreply@example.com>", to: ["sari@example.com"], subject: message.subject });
  });

  it.each([
    [400, "EMAIL_PROVIDER_REJECTED"],
    [422, "EMAIL_PROVIDER_REJECTED"],
    [429, "EMAIL_PROVIDER_UNAVAILABLE"],
    [500, "EMAIL_PROVIDER_UNAVAILABLE"],
  ])("Resend HTTP %i menjadi %s", async (status, code) => {
    const sender = createResendSender("re_test_key_123", "a@example.com", async () => new Response("{}", { status }));
    await expect(sender.send(message, "k")).rejects.toMatchObject({ code });
  });

  it("jaringan gagal atau respons tanpa id dianggap boleh diulang", async () => {
    await expect(createResendSender("re_test_key_123", "a@example.com", async () => { throw new Error("down"); }).send(message, "k")).rejects.toBeInstanceOf(EmailSendError);
    await expect(createResendSender("re_test_key_123", "a@example.com", async () => Response.json({})).send(message, "k")).rejects.toMatchObject({ code: "EMAIL_PROVIDER_UNAVAILABLE" });
  });

  it("Mailpit memakai API kirim lokal", async () => {
    const fetcher = vi.fn<FakeFetch>(async () => Response.json({ ID: "mp-1" }));
    await expect(createMailpitSender("http://127.0.0.1:54324", "noreply@juarasatu.local", fetcher).send(message, "k")).resolves.toEqual({ providerReference: "mp-1" });
    expect(fetcher.mock.calls[0]?.[0]).toBe("http://127.0.0.1:54324/api/v1/send");
  });
});

describe("loadEmailSender", () => {
  it("null bila provider belum dipilih atau kurang lengkap", () => {
    expect(loadEmailSender({})).toBeNull();
    expect(loadEmailSender({ EMAIL_PROVIDER: "resend", EMAIL_FROM: "a@example.com" })).toBeNull();
    expect(loadEmailSender({ EMAIL_PROVIDER: "smtp" })).toBeNull();
  });

  it("Mailpit hanya boleh alamat lokal", () => {
    expect(loadEmailSender({ EMAIL_PROVIDER: "mailpit" })).not.toBeNull();
    expect(loadEmailSender({ EMAIL_PROVIDER: "mailpit", MAILPIT_URL: "http://localhost:54324" })).not.toBeNull();
    expect(loadEmailSender({ EMAIL_PROVIDER: "mailpit", MAILPIT_URL: "https://mail.example.com" })).toBeNull();
  });

  it("Resend lengkap dibuat", () => {
    expect(loadEmailSender({ EMAIL_PROVIDER: "resend", RESEND_API_KEY: "re_test_key_123", EMAIL_FROM: "juarasatu <noreply@example.com>" })).not.toBeNull();
  });
});
