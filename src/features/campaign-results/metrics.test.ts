import { describe, expect, it } from "vitest";
import { campaignWindow, summarizeCampaign, type CampaignFacts, type CampaignOrderFacts } from "@/features/campaign-results/metrics";

const campaign: CampaignFacts = {
  id: "kampanye-1",
  name: "Promo November",
  slug: "promo-november",
  offerType: "percent_discount",
  discountBps: 1000,
  targetAdditionalUnits: 10,
  startsAt: "2026-11-10T00:00:00.000Z",
  endsAt: "2026-11-12T00:00:00.000Z",
  publishedAt: "2026-11-09T12:00:00.000Z",
  closedAt: null,
};
const now = new Date("2026-11-11T00:00:00.000Z");

function paid(changes: Partial<CampaignOrderFacts> = {}): CampaignOrderFacts {
  return {
    source: "public", orderStatus: "awaiting_confirmation", externalPaymentStatus: null, externalPaymentConfirmedAt: null,
    totalIdr: 216000, discountTotalIdr: 24000, quantity: 2, pricingCampaignId: "kampanye-1", attributionCampaignId: null,
    appliedAt: "2026-11-10T05:00:00.000Z", ...changes,
  };
}

describe("campaignWindow", () => {
  it("mulai dari yang paling akhir antara mulai dan terbit", () => {
    expect(campaignWindow({ ...campaign, publishedAt: "2026-11-10T06:00:00.000Z" }).start).toBe("2026-11-10T06:00:00.000Z");
    expect(campaignWindow(campaign).start).toBe("2026-11-10T00:00:00.000Z");
  });

  it("berakhir lebih awal bila kampanye ditutup sebelum jadwal", () => {
    expect(campaignWindow({ ...campaign, closedAt: "2026-11-11T03:00:00.000Z" }).end).toBe("2026-11-11T03:00:00.000Z");
    expect(campaignWindow({ ...campaign, closedAt: "2026-11-13T00:00:00.000Z" }).end).toBe("2026-11-12T00:00:00.000Z");
  });
});

describe("summarizeCampaign", () => {
  it("menghitung pesanan, unit, nilai, promo, dan tautan kampanye dari pembayaran yang diterapkan", () => {
    const result = summarizeCampaign(campaign, [
      paid(),
      paid({ attributionCampaignId: "kampanye-1", quantity: 1, totalIdr: 108000, discountTotalIdr: 12000 }),
      paid({ pricingCampaignId: null, discountTotalIdr: 0, totalIdr: 240000 }),
    ], now);
    expect(result.verified).toEqual({ orders: 3, units: 5, valueIdr: BigInt(564000) });
    expect(result.attributed).toEqual({ orders: 1, units: 1, valueIdr: BigInt(108000) });
    expect(result.discounted).toEqual({ orders: 2, discountGivenIdr: BigInt(36000) });
    expect(result.phase).toBe("running");
  });

  it("periode setengah terbuka: tepat saat mulai dihitung, tepat saat berakhir tidak", () => {
    const result = summarizeCampaign(campaign, [paid({ appliedAt: "2026-11-10T00:00:00.000Z" }), paid({ appliedAt: "2026-11-12T00:00:00.000Z" }), paid({ appliedAt: "2026-11-09T23:59:59.999Z" })], now);
    expect(result.verified.orders).toBe(1);
  });

  it("pembayaran yang belum diterapkan (ditinjau, menunggu, gagal) tidak dihitung", () => {
    const result = summarizeCampaign(campaign, [paid({ appliedAt: null, orderStatus: "requires_review" }), paid({ appliedAt: null, orderStatus: "pending_payment" })], now);
    expect(result.verified).toEqual({ orders: 0, units: 0, valueIdr: BigInt(0) });
  });

  it("pesanan dibatalkan setelah dibayar dikeluarkan dan dihitung terpisah", () => {
    const result = summarizeCampaign(campaign, [paid(), paid({ orderStatus: "cancelled" })], now);
    expect(result.verified.orders).toBe(1);
    expect(result.cancelledAfterPayment).toBe(1);
  });

  it("pesanan manual lunas dihitung terpisah dari pembayaran Sandbox", () => {
    const manual = paid({ source: "manual", externalPaymentStatus: "confirmed", externalPaymentConfirmedAt: "2026-11-10T08:00:00.000Z", appliedAt: null, pricingCampaignId: null });
    const result = summarizeCampaign(campaign, [manual, { ...manual, externalPaymentStatus: "unpaid" }, { ...manual, orderStatus: "cancelled" }], now);
    expect(result.manual).toEqual({ orders: 1, units: 2, valueIdr: BigInt(216000) });
    expect(result.verified.orders).toBe(0);
  });

  it("tautan atau harga dari kampanye lain tidak diklaim kampanye ini", () => {
    const result = summarizeCampaign(campaign, [paid({ pricingCampaignId: "kampanye-lain", attributionCampaignId: "kampanye-lain" })], now);
    expect(result.verified.orders).toBe(1);
    expect(result.attributed.orders).toBe(0);
    expect(result.discounted.orders).toBe(0);
  });

  it("total lintas pesanan di atas batas aman Number tetap tepat", () => {
    const orders = Array.from({ length: 9_100 }, () => paid({ totalIdr: 1_000_000_000 }));
    expect(summarizeCampaign(campaign, orders, now).verified.valueIdr).toBe(BigInt("9100000000000"));
    const big = summarizeCampaign(campaign, [paid({ totalIdr: Number.MAX_SAFE_INTEGER }), paid({ totalIdr: 2 })], now).verified.valueIdr;
    expect(big).toBe(BigInt(Number.MAX_SAFE_INTEGER) + BigInt(2));
  });

  it("fase mengikuti periode efektif", () => {
    expect(summarizeCampaign(campaign, [], new Date("2026-11-09T00:00:00.000Z")).phase).toBe("scheduled");
    expect(summarizeCampaign(campaign, [], new Date("2026-11-12T00:00:00.000Z")).phase).toBe("ended");
    expect(summarizeCampaign({ ...campaign, closedAt: "2026-11-10T12:00:00.000Z" }, [], now).phase).toBe("ended");
  });
});
