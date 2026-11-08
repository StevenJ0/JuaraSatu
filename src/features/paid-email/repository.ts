import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PaidEmailFacts } from "@/features/paid-email/template";

const rowSchema = z.object({
  id: z.uuid(),
  public_order_number: z.string(),
  customer_name: z.string(),
  customer_email: z.string().nullable(),
  fulfillment_date: z.string(),
  subtotal_idr: z.number().int(),
  discount_total_idr: z.number().int(),
  total_idr: z.number().int(),
  businesses: z.object({ name: z.string() }),
  preorders: z.object({
    name: z.string(),
    pickup_terms_snapshot: z.object({ pickup_instructions: z.string(), public_contact: z.string().nullable(), fulfillment_window_end_at: z.string() }),
  }).nullable(),
  order_items: z.tuple([
    z.object({
      product_name_snapshot: z.string(),
      sku_snapshot: z.string(),
      quantity: z.number().int(),
      base_unit_price_idr: z.number().int(),
      discount_per_unit_idr: z.number().int(),
      final_unit_price_idr: z.number().int(),
    }),
  ]),
  payments: z.array(z.object({ status: z.string(), applied_at: z.string().nullable() })),
});

const COLUMNS = `id, public_order_number, customer_name, customer_email, fulfillment_date, subtotal_idr, discount_total_idr, total_idr,
  businesses(name), preorders(name, pickup_terms_snapshot),
  order_items(product_name_snapshot, sku_snapshot, quantity, base_unit_price_idr, discount_per_unit_idr, final_unit_price_idr),
  payments(status, applied_at)`;

export type PaidEmailLookup = { kind: "ready"; facts: PaidEmailFacts } | { kind: "not_applied" } | { kind: "not_found" };

/**
 * Fakta email untuk satu pesanan. `client` wajib service role. Email hanya untuk pembayaran Sandbox yang benar-benar diterapkan
 * (kontrak C5 §8), jadi worker memeriksa ulang di sini, bukan percaya pada keberadaan job saja.
 */
export async function findPaidEmailFacts(client: SupabaseClient, orderId: string): Promise<PaidEmailLookup> {
  const { data, error } = await client.from("orders").select(COLUMNS).eq("id", orderId).maybeSingle();
  if (error) throw new Error(`findPaidEmailFacts gagal (${error.code})`);
  if (data === null) return { kind: "not_found" };
  const row = rowSchema.parse(data);
  const applied = row.payments.some((payment) => payment.status === "paid_sandbox" && payment.applied_at !== null);
  const email = z.email().safeParse(row.customer_email);
  if (!applied || !email.success || row.preorders === null) return { kind: "not_applied" };
  const [item] = row.order_items;
  const terms = row.preorders.pickup_terms_snapshot;
  return {
    kind: "ready",
    facts: {
      orderId: row.id,
      publicOrderNumber: row.public_order_number,
      customerName: row.customer_name,
      customerEmail: email.data,
      businessName: row.businesses.name,
      preorderName: row.preorders.name,
      productName: item.product_name_snapshot,
      sku: item.sku_snapshot,
      quantity: item.quantity,
      baseUnitPriceIdr: item.base_unit_price_idr,
      discountPerUnitIdr: item.discount_per_unit_idr,
      finalUnitPriceIdr: item.final_unit_price_idr,
      subtotalIdr: row.subtotal_idr,
      discountTotalIdr: row.discount_total_idr,
      totalIdr: row.total_idr,
      fulfillmentDate: row.fulfillment_date,
      fulfillmentWindowEndAt: terms.fulfillment_window_end_at,
      pickupInstructions: terms.pickup_instructions,
      publicContact: terms.public_contact,
    },
  };
}
