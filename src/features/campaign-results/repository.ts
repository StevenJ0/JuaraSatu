import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { summarizeCampaign, type CampaignOrderFacts, type CampaignResult } from "@/features/campaign-results/metrics";

const campaignRowSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  slug: z.string(),
  offer_type: z.enum(["normal_price", "percent_discount"]),
  discount_bps: z.number().int(),
  target_additional_units: z.number().int(),
  starts_at: z.string(),
  ends_at: z.string(),
  published_at: z.string(),
  closed_at: z.string().nullable(),
});

const orderRowSchema = z.object({
  source: z.enum(["public", "manual"]),
  order_status: z.string(),
  external_payment_status: z.enum(["unpaid", "confirmed", "voided"]).nullable(),
  external_payment_confirmed_at: z.string().nullable(),
  total_idr: z.number().int(),
  discount_total_idr: z.number().int(),
  pricing_campaign_id: z.uuid().nullable(),
  attribution_campaign_id: z.uuid().nullable(),
  order_items: z.tuple([z.object({ quantity: z.number().int() })]),
  payments: z.array(z.object({ status: z.string(), applied_at: z.string().nullable() })),
});

// Hanya kampanye yang pernah terbit punya periode dan hasil. Draf dan yang dibatalkan sebelum terbit tidak ditampilkan.
const RESULT_STATUSES = ["published", "closed", "completed"] as const;

export class CampaignResultsError extends Error {
  constructor(operation: string) {
    super(`Hasil kampanye gagal dibaca: ${operation}`);
    this.name = "CampaignResultsError";
  }
}

function toOrderFacts(row: z.infer<typeof orderRowSchema>): CampaignOrderFacts {
  return {
    source: row.source,
    orderStatus: row.order_status,
    externalPaymentStatus: row.external_payment_status,
    externalPaymentConfirmedAt: row.external_payment_confirmed_at,
    totalIdr: row.total_idr,
    discountTotalIdr: row.discount_total_idr,
    quantity: row.order_items[0].quantity,
    pricingCampaignId: row.pricing_campaign_id,
    attributionCampaignId: row.attribution_campaign_id,
    appliedAt: row.payments.find((payment) => payment.status === "paid_sandbox" && payment.applied_at !== null)?.applied_at ?? null,
  };
}

/**
 * Hasil setiap kampanye terbit pada satu preorder. `client` wajib client bersesi pemilik, sehingga RLS membatasi ke usahanya.
 * Semua pesanan preorder dibaca sekaligus. Bila jumlahnya terpotong batas baris API, fungsi gagal tertutup, bukan menampilkan angka kurang.
 */
export async function listPreorderCampaignResults(client: SupabaseClient, businessId: string, preorderId: string, now: Date = new Date()): Promise<CampaignResult[]> {
  const campaigns = await client
    .from("campaigns")
    .select("id, name, slug, offer_type, discount_bps, target_additional_units, starts_at, ends_at, published_at, closed_at")
    .eq("business_id", businessId)
    .eq("preorder_id", preorderId)
    .in("status", RESULT_STATUSES)
    .order("published_at", { ascending: false });
  if (campaigns.error) throw new CampaignResultsError("campaigns");
  const campaignRows = z.array(campaignRowSchema).parse(campaigns.data);
  if (campaignRows.length === 0) return [];

  const orders = await client
    .from("orders")
    .select(
      `source, order_status, external_payment_status, external_payment_confirmed_at, total_idr, discount_total_idr, pricing_campaign_id, attribution_campaign_id,
      order_items(quantity), payments(status, applied_at)`,
      { count: "exact" },
    )
    .eq("business_id", businessId)
    .eq("preorder_id", preorderId);
  if (orders.error) throw new CampaignResultsError("orders");
  const orderRows = z.array(orderRowSchema).parse(orders.data);
  if (orders.count !== orderRows.length) throw new CampaignResultsError("orders terpotong");
  const facts = orderRows.map(toOrderFacts);

  return campaignRows.map((row) =>
    summarizeCampaign(
      {
        id: row.id,
        name: row.name,
        slug: row.slug,
        offerType: row.offer_type,
        discountBps: row.discount_bps,
        targetAdditionalUnits: row.target_additional_units,
        startsAt: row.starts_at,
        endsAt: row.ends_at,
        publishedAt: row.published_at,
        closedAt: row.closed_at,
      },
      facts,
      now,
    ),
  );
}
