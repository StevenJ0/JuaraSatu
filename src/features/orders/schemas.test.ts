import { describe, expect, it } from "vitest";
import { cancelOrderSchema, manualOrderSchema, orderActionSchema, publicOrderSchema } from "@/features/orders/schemas";

const manual = {
  preorderId: "11111111-1111-4111-8111-111111111111",
  idempotencyKey: "22222222-2222-4222-8222-222222222222",
  customerName: "  Budi ",
  customerEmail: "",
  customerContact: " 0812 ",
  quantity: "3",
  paymentStatus: "unpaid",
};

const buyer = {
  slug: "kaos-abc123",
  idempotencyKey: "kunci-yang-cukup-panjang",
  privateToken: "t".repeat(43),
  customerName: "Budi",
  customerEmail: " Budi@Example.COM ",
  customerContact: "",
  quantity: 2,
  expectedUnitPriceIdr: 120000,
};

describe("manualOrderSchema", () => {
  it("email dan kontak boleh kosong", () => {
    expect(manualOrderSchema.parse(manual)).toMatchObject({ customerName: "Budi", customerEmail: null, customerContact: "0812", quantity: 3 });
  });

  it("menolak email yang salah format bila diisi", () => {
    expect(manualOrderSchema.safeParse({ ...manual, customerEmail: "bukan-email" }).success).toBe(false);
  });

  it.each(["0", "-1", "1.5", "", "10001"])("menolak jumlah %j", (quantity) => {
    expect(manualOrderSchema.safeParse({ ...manual, quantity }).success).toBe(false);
  });

  it("wajib memilih status pembayaran", () => {
    const result = manualOrderSchema.safeParse({ ...manual, paymentStatus: "" });
    expect(result.error?.issues[0]?.message).toBe("Pilih status pembayaran");
  });

  it("wajib nama", () => {
    expect(manualOrderSchema.safeParse({ ...manual, customerName: "  " }).success).toBe(false);
  });

  it("mengabaikan isian harga dari browser", () => {
    expect(manualOrderSchema.parse({ ...manual, totalIdr: 1, businessId: "lain" })).not.toHaveProperty("totalIdr");
  });
});

describe("publicOrderSchema", () => {
  it("menormalkan email", () => {
    expect(publicOrderSchema.parse(buyer).customerEmail).toBe("budi@example.com");
  });

  it("email wajib untuk pembeli", () => {
    expect(publicOrderSchema.safeParse({ ...buyer, customerEmail: "" }).success).toBe(false);
  });

  it.each([0, 1.5, 10001])("menolak jumlah %j", (quantity) => {
    expect(publicOrderSchema.safeParse({ ...buyer, quantity }).success).toBe(false);
  });

  it("menolak token dan kunci yang terlalu pendek", () => {
    expect(publicOrderSchema.safeParse({ ...buyer, privateToken: "pendek" }).success).toBe(false);
    expect(publicOrderSchema.safeParse({ ...buyer, idempotencyKey: "pendek" }).success).toBe(false);
  });
});

describe("orderActionSchema", () => {
  const ref = { orderId: manual.preorderId, version: "2" };

  it("menerima aksi yang dikenal", () => {
    expect(orderActionSchema.parse({ ...ref, action: "confirm" })).toMatchObject({ action: "confirm", version: 2 });
  });

  it("menolak aksi tak dikenal", () => {
    expect(orderActionSchema.safeParse({ ...ref, action: "refund" }).success).toBe(false);
  });
});

describe("cancelOrderSchema", () => {
  const ref = { orderId: manual.preorderId, version: "1" };

  it("wajib alasan", () => {
    expect(cancelOrderSchema.safeParse({ ...ref, reason: "   " }).error?.issues[0]?.message).toBe("Tulis alasan pembatalan");
  });

  it("menolak alasan terlalu panjang", () => {
    expect(cancelOrderSchema.safeParse({ ...ref, reason: "a".repeat(501) }).success).toBe(false);
  });
});
