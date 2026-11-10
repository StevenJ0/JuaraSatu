import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { OrderEmailFacts } from "@/features/paid-email/template";

const rowSchema = z.object({
  id: z.uuid(),
  business_id: z.uuid(),
  public_order_number: z.string(),
  customer_name: z.string(),
  customer_email: z.string().nullable(),
  customer_contact: z.string().nullable(),
  payment_due_at: z.string().nullable(),
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

const COLUMNS = `id, business_id, public_order_number, customer_name, customer_email, customer_contact, payment_due_at, fulfillment_date, subtotal_idr, discount_total_idr, total_idr,
  businesses(name), preorders(name, pickup_terms_snapshot),
  order_items(product_name_snapshot, sku_snapshot, quantity, base_unit_price_idr, discount_per_unit_idr, final_unit_price_idr),
  payments(status, applied_at)`;

export type PaidEmailLookup = { kind: "ready"; facts: OrderEmailFacts; businessId: string } | { kind: "not_applied" } | { kind: "not_found" };
export type OrderEmailLookup = { kind: "found"; facts: OrderEmailFacts; businessId: string; paid: boolean } | { kind: "unusable" } | { kind: "not_found" };

/** Fakta email satu pesanan, lunas atau belum. `client` wajib service role. "unusable" bila email pembeli atau preorder tidak ada. */
export async function findOrderEmailFacts(client: SupabaseClient, orderId: string): Promise<OrderEmailLookup> {
  const { data, error } = await client.from("orders").select(COLUMNS).eq("id", orderId).maybeSingle();
  if (error) throw new Error(`findOrderEmailFacts gagal (${error.code})`);
  if (data === null) return { kind: "not_found" };
  const row = rowSchema.parse(data);
  const email = z.email().safeParse(row.customer_email);
  if (!email.success || row.preorders === null) return { kind: "unusable" };
  const paid = row.payments.some((payment) => payment.status === "paid_sandbox" && payment.applied_at !== null);
  const [item] = row.order_items;
  const terms = row.preorders.pickup_terms_snapshot;
  return {
    kind: "found",
    businessId: row.business_id,
    paid,
    facts: {
      orderId: row.id,
      customerContact: row.customer_contact,
      paymentDueAt: row.payment_due_at,
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

/**
 * Fakta email lunas. Email hanya untuk pembayaran Sandbox yang benar-benar diterapkan (kontrak C5 §8), jadi worker memeriksa
 * ulang di sini, bukan percaya pada keberadaan job saja.
 */
export async function findPaidEmailFacts(client: SupabaseClient, orderId: string): Promise<PaidEmailLookup> {
  const lookup = await findOrderEmailFacts(client, orderId);
  if (lookup.kind === "not_found") return lookup;
  if (lookup.kind === "unusable" || !lookup.paid) return { kind: "not_applied" };
  return { kind: "ready", facts: lookup.facts, businessId: lookup.businessId };
}

/** Email login pemilik usaha, dibaca lewat Auth admin (service role). Null bila tidak ada pemilik atau emailnya. */
export async function findOwnerEmail(client: SupabaseClient, businessId: string): Promise<string | null> {
  const { data, error } = await client.from("business_members").select("user_id").eq("business_id", businessId).eq("role", "owner").limit(1).maybeSingle();
  if (error) throw new Error(`findOwnerEmail gagal (${error.code})`);
  const member = z.object({ user_id: z.uuid() }).safeParse(data);
  if (!member.success) return null;
  const { data: user, error: authError } = await client.auth.admin.getUserById(member.data.user_id);
  if (authError) throw new Error(`findOwnerEmail gagal (${authError.code ?? "auth"})`);
  const email = z.email().safeParse(user.user?.email);
  return email.success ? email.data : null;
}

/** ID pesanan dari hash token halaman pesanan; token mentahnya tetap hanya di memori pemanggil. */
export async function findOrderIdByTokenHash(client: SupabaseClient, tokenHash: string): Promise<string | null> {
  const { data, error } = await client.from("orders").select("id").eq("private_token_hash", tokenHash).maybeSingle();
  if (error) throw new Error(`findOrderIdByTokenHash gagal (${error.code})`);
  const row = z.object({ id: z.uuid() }).safeParse(data);
  return row.success ? row.data.id : null;
}
