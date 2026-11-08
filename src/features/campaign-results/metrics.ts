/**
 * Hasil kampanye (P3-1) yang dihitung kode, bukan AI. Definisinya mengikuti rencana MVP §D:
 * - Pesanan Sandbox sah: pembayaran `paid_sandbox` yang sudah diterapkan (`applied_at` terisi) di dalam periode kampanye.
 *   Pembayaran yang masih ditinjau, kedaluwarsa, atau gagal tidak dihitung.
 * - Periode setengah terbuka: dari max(mulai, terbit) sampai sebelum min(berakhir, ditutup), memakai `applied_at`.
 * - Nilai dijumlah sekali per pesanan dengan BigInt, agar total lintas pesanan tidak kehilangan presisi.
 * - Pesanan manual lunas dihitung terpisah, tidak dicampur dengan pembayaran Sandbox terverifikasi.
 * Angka ini bukan bukti kampanye menyebabkan penjualan.
 */

export type CampaignFacts = {
  id: string;
  name: string;
  slug: string;
  offerType: "normal_price" | "percent_discount";
  discountBps: number;
  targetAdditionalUnits: number;
  startsAt: string;
  endsAt: string;
  publishedAt: string;
  closedAt: string | null;
};

export type CampaignOrderFacts = {
  source: "public" | "manual";
  orderStatus: string;
  externalPaymentStatus: "unpaid" | "confirmed" | "voided" | null;
  externalPaymentConfirmedAt: string | null;
  totalIdr: number;
  discountTotalIdr: number;
  quantity: number;
  pricingCampaignId: string | null;
  attributionCampaignId: string | null;
  /** Waktu pembayaran `paid_sandbox` diterapkan. Null bila belum ada yang diterapkan. */
  appliedAt: string | null;
};

export type CohortTotals = { orders: number; units: number; valueIdr: bigint };

export type CampaignPhase = "scheduled" | "running" | "ended";

export type CampaignResult = {
  campaign: CampaignFacts;
  phase: CampaignPhase;
  window: { start: string; end: string };
  /** Pesanan Sandbox sah di periode kampanye, termasuk yang dipesan tanpa tautan kampanye. */
  verified: CohortTotals;
  /** Bagian dari `verified` yang datang lewat tautan kampanye yang sah. */
  attributed: CohortTotals;
  /** Bagian dari `verified` yang mendapat harga promo kampanye ini. Selalu nol untuk kampanye harga normal. */
  discounted: { orders: number; discountGivenIdr: bigint };
  /** Lunas di luar aplikasi selama periode. Tidak termasuk `verified`. */
  manual: CohortTotals;
  /** Sudah dibayar di periode, lalu dibatalkan. Tidak termasuk `verified`. */
  cancelledAfterPayment: number;
};

const EMPTY: CohortTotals = { orders: 0, units: 0, valueIdr: BigInt(0) };

function add(totals: CohortTotals, order: CampaignOrderFacts): CohortTotals {
  return { orders: totals.orders + 1, units: totals.units + order.quantity, valueIdr: totals.valueIdr + BigInt(order.totalIdr) };
}

function inWindow(instant: string | null, start: number, end: number): boolean {
  if (instant === null) return false;
  const time = Date.parse(instant);
  return time >= start && time < end;
}

export function campaignWindow(campaign: CampaignFacts): { start: string; end: string } {
  const start = Math.max(Date.parse(campaign.startsAt), Date.parse(campaign.publishedAt));
  const end = campaign.closedAt === null ? Date.parse(campaign.endsAt) : Math.min(Date.parse(campaign.endsAt), Date.parse(campaign.closedAt));
  return { start: new Date(start).toISOString(), end: new Date(Math.max(start, end)).toISOString() };
}

export function summarizeCampaign(campaign: CampaignFacts, orders: readonly CampaignOrderFacts[], now: Date): CampaignResult {
  const window = campaignWindow(campaign);
  const start = Date.parse(window.start);
  const end = Date.parse(window.end);
  const phase: CampaignPhase = now.getTime() < start ? "scheduled" : now.getTime() >= end ? "ended" : "running";

  let verified = EMPTY;
  let attributed = EMPTY;
  let manual = EMPTY;
  let discountedOrders = 0;
  let discountGivenIdr = BigInt(0);
  let cancelledAfterPayment = 0;

  for (const order of orders) {
    const cancelled = order.orderStatus === "cancelled";
    if (order.source === "manual") {
      if (!cancelled && order.externalPaymentStatus === "confirmed" && inWindow(order.externalPaymentConfirmedAt, start, end)) manual = add(manual, order);
      continue;
    }
    if (!inWindow(order.appliedAt, start, end)) continue;
    if (cancelled) {
      cancelledAfterPayment += 1;
      continue;
    }
    verified = add(verified, order);
    if (order.attributionCampaignId === campaign.id) attributed = add(attributed, order);
    if (order.pricingCampaignId === campaign.id) {
      discountedOrders += 1;
      discountGivenIdr += BigInt(order.discountTotalIdr);
    }
  }

  return { campaign, phase, window, verified, attributed, discounted: { orders: discountedOrders, discountGivenIdr }, manual, cancelledAfterPayment };
}
