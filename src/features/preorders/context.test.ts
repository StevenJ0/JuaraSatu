import { describe, expect, it } from "vitest";
import { resolvePublicAvailability, toPreorderContext, toPublicPreorder } from "@/features/preorders/context";
import { computeOrderableUnits, summarizePreorder, type PreorderReservationFact } from "@/features/preorders/metrics";
import type { Preorder } from "@/features/preorders/repository";

const now = new Date("2026-11-10T05:00:00.000Z");
const before = "2026-11-10T04:00:00.000Z";
const after = "2026-11-10T06:00:00.000Z";
const open = { status: "published", startsAt: before, endsAt: after, intakeCutoffAt: after, orderableUnits: 8 } as const;

const publicFacts = {
  ...open,
  slug: "kaos-abc123",
  name: "Preorder Kaos",
  unitPriceIdr: 108000,
  basePriceIdr: 120000,
  discountBps: 1000,
  fulfillmentDate: "2026-11-20",
  fulfillmentWindowEndAt: "2026-11-20T10:00:00.000Z",
  businessName: "Toko Contoh",
  product: { name: "Kaos", description: null, photoUrl: null, thumbnailUrl: null },
  pickup: { instructions: "Ambil di toko", publicContact: null },
  version: 2,
};

describe("resolvePublicAvailability", () => {
  it("terbit, sudah mulai, dan masih ada sisa berarti buka", () => {
    expect(resolvePublicAvailability(open, now)).toBe("open");
  });

  it("tepat saat mulai sudah buka, sama dengan database", () => {
    expect(resolvePublicAvailability({ ...open, startsAt: now.toISOString() }, now)).toBe("open");
  });

  it("sebelum waktu mulai belum buka", () => {
    expect(resolvePublicAvailability({ ...open, startsAt: after, endsAt: after }, now)).toBe("not_started");
  });

  it("tepat saat berakhir atau batas pesan sudah tutup, sama dengan database", () => {
    expect(resolvePublicAvailability({ ...open, endsAt: now.toISOString() }, now)).toBe("closed");
    expect(resolvePublicAvailability({ ...open, intakeCutoffAt: now.toISOString() }, now)).toBe("closed");
  });

  it("sudah ditutup atau selesai tetap tutup walau masih dalam jadwal dan ada sisa", () => {
    expect(resolvePublicAvailability({ ...open, status: "closed" }, now)).toBe("closed");
    expect(resolvePublicAvailability({ ...open, status: "completed" }, now)).toBe("closed");
  });

  it("sisa nol berarti penuh, tapi jadwal lewat tetap dibaca tutup", () => {
    expect(resolvePublicAvailability({ ...open, orderableUnits: 0 }, now)).toBe("sold_out");
    expect(resolvePublicAvailability({ ...open, orderableUnits: 0, endsAt: before }, now)).toBe("closed");
  });
});

describe("toPublicPreorder", () => {
  it("hanya memuat field yang diizinkan walau masukannya membawa data privat", () => {
    const withPrivateData = {
      ...publicFacts,
      variableCostIdr: 75000,
      targetUnits: 40,
      customerEmail: "pembeli@example.com",
      product: { ...publicFacts.product, variableCostIdr: 75000, sku: "SKU-1" },
      pickup: { ...publicFacts.pickup, privateToken: "rahasia" },
    };

    const result = toPublicPreorder(withPrivateData, now);

    expect(Object.keys(result).sort()).toEqual(
      [
        "asOf",
        "availability",
        "basePriceIdr",
        "businessName",
        "discountBps",
        "endsAt",
        "fulfillmentDate",
        "fulfillmentWindowEndAt",
        "intakeCutoffAt",
        "name",
        "orderableUnits",
        "pickup",
        "product",
        "slug",
        "startsAt",
        "unitPriceIdr",
        "version",
      ].sort(),
    );
    const text = JSON.stringify(result);
    for (const forbidden of ["75000", "SKU-1", "pembeli@example.com", "rahasia", "status"]) expect(text).not.toContain(forbidden);
  });

  it("sisa ditampilkan saat buka dan nol saat tidak bisa dipesan", () => {
    expect(toPublicPreorder(publicFacts, now)).toMatchObject({ availability: "open", orderableUnits: 8, asOf: now.toISOString() });
    expect(toPublicPreorder({ ...publicFacts, status: "closed" }, now)).toMatchObject({ availability: "closed", orderableUnits: 0 });
    expect(toPublicPreorder({ ...publicFacts, startsAt: after, endsAt: after }, now)).toMatchObject({ availability: "not_started", orderableUnits: 0 });
  });
});

describe("sisa pembeli sama dengan dashboard pemilik", () => {
  const allocated = (quantity: number): PreorderReservationFact => ({ quantity, state: "allocated", expiresAt: null, payment: "paid" });
  const held = (quantity: number, expiresAt = after): PreorderReservationFact => ({ quantity, state: "held", expiresAt, payment: "awaiting" });

  it.each([
    { name: "acceptance 40, 30, 2", event: [allocated(30), held(2)], other: [], total: 40, orderable: 8 },
    { name: "hold kedaluwarsa", event: [allocated(30), held(2, before)], other: [], total: 40, orderable: 10 },
    { name: "dibatasi pesanan lain di kapasitas sama", event: [allocated(30), held(2)], other: [allocated(5)], total: 40, orderable: 3 },
    { name: "kapasitas diturunkan di bawah pemakaian", event: [allocated(30)], other: [], total: 10, orderable: 0 },
  ])("$name", ({ event, other, total, orderable }) => {
    const shared = { quotaUnits: 40, capacityTotalUnits: total, preorderReservations: event, capacityReservations: [...event, ...other] };

    expect(computeOrderableUnits(shared, now)).toBe(orderable);
    expect(summarizePreorder({ ...shared, targetUnits: 40 }, now).orderableUnits).toBe(orderable);
  });
});

describe("toPreorderContext", () => {
  const preorder: Preorder = {
    id: "preorder-1",
    name: "Preorder Kaos",
    slug: "kaos-abc123",
    status: "published",
    fulfillmentDate: "2026-11-20",
    startsAt: before,
    endsAt: after,
    version: 3,
    productId: "product-1",
    productName: "Kaos",
    capacityId: "capacity-1",
    targetUnits: 40,
    quotaUnits: 40,
    basePriceIdr: 120000,
    intakeCutoffAt: after,
    fulfillmentWindowEndAt: "2026-11-20T10:00:00.000Z",
    frozenTerms: null,
    metrics: {
      paidUnits: 28,
      awaitingPaymentUnits: 4,
      paidTargetGap: 12,
      orderableUnits: 8,
      quotaUsage: { allocated: 30, effectiveHeld: 2, available: 8 },
    },
  };

  it("memisahkan dibayar, terpakai, ditahan, sisa, dan selisih target", () => {
    const context = toPreorderContext(
      preorder,
      { id: "business-1", name: "Toko Contoh", categories: ["Fashion"], description: null },
      { description: null, costQuality: "estimated", isActive: true, variableCostIdr: 75000, catalogPriceIdr: 130000, version: 2 },
      { itemId: "item-1", itemVersion: 2, capacity: { id: "capacity-1", version: 4, totalUnits: 60,
        availability: { allocated: 30, effectiveHeld: 2, available: 28 } } },
      now,
    );

    expect(context.units).toEqual({ paid: 28, allocated: 30, held: 2, orderable: 8, paidTargetGap: 12 });
    expect(context.product).toMatchObject({ basePriceIdr: 120000, costQuality: "estimated" });
    expect(context.preorder).toMatchObject({ targetUnits: 40, quotaUnits: 40, version: 3, status: "published" });
    expect(context.asOf).toBe(now.toISOString());
  });

  it("projection owner membawa biaya yang disetujui untuk C1 tanpa kontak privat atau field publik lain", () => {
    const business = { id: "business-1", name: "Toko Contoh", categories: [], description: null, publicContact: "0812" };
    const product = { description: null, costQuality: "verified" as const, isActive: true, variableCostIdr: 75000,
      catalogPriceIdr: 130000, version: 2 };

    const context = toPreorderContext(preorder, business, product, { itemId: "item-1", itemVersion: 2,
      capacity: { id: "capacity-1", version: 4, totalUnits: 60, availability: { allocated: 30, effectiveHeld: 2, available: 28 } } }, now);

    const text = JSON.stringify(context);
    expect(context.product.variableCostIdr).toBe(75000);
    for (const forbidden of ["0812", "slug", "frozenTerms"]) expect(text).not.toContain(forbidden);
  });
});
