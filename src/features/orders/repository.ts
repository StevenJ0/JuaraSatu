import "server-only";
import { z } from "zod";
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import type { ManualOrderInput, OrderAction } from "@/features/orders/schemas";
import type { ExternalPaymentStatus, FulfillmentStatus, OrderStatus } from "@/features/orders/status";

export const ORDER_VIOLATIONS = [
  "VALIDATION_ERROR",
  "ORDER_NOT_FOUND",
  "VERSION_CONFLICT",
  "ORDER_STATE_INVALID",
  "PREORDER_NOT_OPEN",
  "CAPACITY_UNAVAILABLE",
  "OFFER_CHANGED",
  "IDEMPOTENCY_CONFLICT",
] as const;
export type OrderViolation = (typeof ORDER_VIOLATIONS)[number];

function parseViolation(message: string): OrderViolation | null {
  return ORDER_VIOLATIONS.find((violation) => message.includes(violation)) ?? null;
}

export class OrderRepositoryError extends Error {
  constructor(
    operation: string,
    readonly code: string | undefined,
    readonly violation: OrderViolation | null,
  ) {
    super(`Order repository gagal: ${operation}${code ? ` (${code})` : ""}`);
    this.name = "OrderRepositoryError";
  }
}

function fail(operation: string, error: PostgrestError): never {
  throw new OrderRepositoryError(operation, error.code, parseViolation(error.message));
}

const orderResultSchema = z.object({
  order_id: z.uuid(),
  public_order_number: z.string(),
  order_status: z.string(),
  total_idr: z.number(),
  payment_due_at: z.string().nullable(),
  replayed: z.boolean(),
});

export type OrderResult = {
  orderId: string;
  publicOrderNumber: string;
  orderStatus: string;
  totalIdr: number;
  paymentDueAt: string | null;
  replayed: boolean;
};

function toOrderResult(data: unknown): OrderResult {
  const row = orderResultSchema.parse(data);
  return {
    orderId: row.order_id,
    publicOrderNumber: row.public_order_number,
    orderStatus: row.order_status,
    totalIdr: row.total_idr,
    paymentDueAt: row.payment_due_at,
    replayed: row.replayed,
  };
}

const orderRowSchema = z.object({
  id: z.uuid(),
  preorder_id: z.uuid().nullable(),
  public_order_number: z.string(),
  source: z.enum(["public", "manual"]),
  customer_name: z.string(),
  customer_email: z.string().nullable(),
  customer_contact: z.string().nullable(),
  fulfillment_date: z.string(),
  external_payment_status: z.enum(["unpaid", "confirmed", "voided"]).nullable(),
  order_status: z.enum(["pending_payment", "awaiting_confirmation", "active", "expired", "cancelled", "requires_review"]),
  fulfillment_status: z.enum(["pending_confirmation", "confirmed", "in_production", "ready", "fulfilled", "cancelled"]),
  total_idr: z.number(),
  payment_due_at: z.string().nullable(),
  cancel_reason: z.string().nullable(),
  version: z.number(),
  created_at: z.string(),
  order_items: z.tuple([
    z.object({
      quantity: z.number(),
      final_unit_price_idr: z.number(),
      product_name_snapshot: z.string(),
    }),
  ]),
});

const ORDER_COLUMNS = `id, preorder_id, public_order_number, source, customer_name, customer_email, customer_contact, fulfillment_date,
  external_payment_status, order_status, fulfillment_status, total_idr, payment_due_at, cancel_reason, version, created_at,
  order_items(quantity, final_unit_price_idr, product_name_snapshot)`;

export type Order = {
  id: string;
  preorderId: string | null;
  publicOrderNumber: string;
  source: "public" | "manual";
  customerName: string;
  customerEmail: string | null;
  customerContact: string | null;
  fulfillmentDate: string;
  externalPaymentStatus: ExternalPaymentStatus | null;
  orderStatus: OrderStatus;
  fulfillmentStatus: FulfillmentStatus;
  totalIdr: number;
  paymentDueAt: string | null;
  cancelReason: string | null;
  version: number;
  createdAt: string;
  quantity: number;
  unitPriceIdr: number;
  productName: string;
};

function toOrder(row: z.infer<typeof orderRowSchema>): Order {
  const [item] = row.order_items;
  return {
    id: row.id,
    preorderId: row.preorder_id,
    publicOrderNumber: row.public_order_number,
    source: row.source,
    customerName: row.customer_name,
    customerEmail: row.customer_email,
    customerContact: row.customer_contact,
    fulfillmentDate: row.fulfillment_date,
    externalPaymentStatus: row.external_payment_status,
    orderStatus: row.order_status,
    fulfillmentStatus: row.fulfillment_status,
    totalIdr: row.total_idr,
    paymentDueAt: row.payment_due_at,
    cancelReason: row.cancel_reason,
    version: row.version,
    createdAt: row.created_at,
    quantity: item.quantity,
    unitPriceIdr: item.final_unit_price_idr,
    productName: item.product_name_snapshot,
  };
}

export async function listPreorderOrders(client: SupabaseClient, businessId: string, preorderId: string): Promise<Order[]> {
  const { data, error } = await client
    .from("orders")
    .select(ORDER_COLUMNS)
    .eq("business_id", businessId)
    .eq("preorder_id", preorderId)
    .order("created_at", { ascending: false });
  if (error) fail("listPreorderOrders", error);
  return z.array(orderRowSchema).parse(data).map(toOrder);
}

export async function findOrder(client: SupabaseClient, businessId: string, orderId: string): Promise<Order | null> {
  const { data, error } = await client.from("orders").select(ORDER_COLUMNS).eq("business_id", businessId).eq("id", orderId).maybeSingle();
  if (error) fail("findOrder", error);
  return data === null ? null : toOrder(orderRowSchema.parse(data));
}

const orderEventRowSchema = z.object({ event_type: z.string(), occurred_at: z.string() });
export type OrderEvent = { eventType: string; occurredAt: string };

export async function listOrderEvents(client: SupabaseClient, businessId: string, orderId: string): Promise<OrderEvent[]> {
  const { data, error } = await client
    .from("order_events")
    .select("event_type, occurred_at")
    .eq("business_id", businessId)
    .eq("order_id", orderId)
    .order("occurred_at", { ascending: true });
  if (error) fail("listOrderEvents", error);
  return z
    .array(orderEventRowSchema)
    .parse(data)
    .map((row) => ({ eventType: row.event_type, occurredAt: row.occurred_at }));
}

const productionCostRowSchema = z.object({
  amount_idr: z.number().nullable(),
  quality: z.enum(["unknown", "estimated", "verified"]),
});
export type OrderProductionCost = { amountIdr: number | null; quality: "unknown" | "estimated" | "verified" };

export async function findOrderProductionCost(client: SupabaseClient, businessId: string, orderId: string): Promise<OrderProductionCost | null> {
  const { data, error } = await client
    .from("order_production_costs")
    .select("amount_idr, quality, order_items!inner(order_id)")
    .eq("business_id", businessId)
    .eq("order_items.order_id", orderId)
    .maybeSingle();
  if (error) fail("findOrderProductionCost", error);
  if (data === null) return null;
  const row = productionCostRowSchema.parse(data);
  return { amountIdr: row.amount_idr, quality: row.quality };
}

export async function createManualOrderRecord(client: SupabaseClient, input: ManualOrderInput, requestHash: string): Promise<OrderResult> {
  const { data, error } = await client.rpc("create_manual_order", {
    p_preorder_id: input.preorderId,
    p_quantity: input.quantity,
    p_customer_name: input.customerName,
    p_customer_email: input.customerEmail,
    p_customer_contact: input.customerContact,
    p_is_paid: input.paymentStatus === "paid",
    p_idempotency_key: input.idempotencyKey,
    p_request_hash: requestHash,
  });
  if (error) fail("createManualOrder", error);
  return toOrderResult(data);
}

export type PublicOrderRecord = {
  slug: string;
  quantity: number;
  customerName: string;
  customerEmail: string;
  customerContact: string | null;
  tokenHash: string;
  idempotencyKey: string;
  requestHash: string;
  expectedUnitPriceIdr: number;
  holdTtlSeconds: number;
};

export async function createPublicOrderRecord(client: SupabaseClient, record: PublicOrderRecord): Promise<OrderResult> {
  const { data, error } = await client.rpc("create_preorder_order", {
    p_slug: record.slug,
    p_quantity: record.quantity,
    p_customer_name: record.customerName,
    p_customer_email: record.customerEmail,
    p_customer_contact: record.customerContact,
    p_token_hash: record.tokenHash,
    p_idempotency_key: record.idempotencyKey,
    p_request_hash: record.requestHash,
    p_expected_unit_price_idr: record.expectedUnitPriceIdr,
    p_hold_ttl_seconds: record.holdTtlSeconds,
  });
  if (error) fail("createPublicOrder", error);
  return toOrderResult(data);
}

export async function advanceOrder(client: SupabaseClient, orderId: string, expectedVersion: number, action: OrderAction): Promise<void> {
  const { error } = await client.rpc("advance_fulfillment", { p_order_id: orderId, p_expected_version: expectedVersion, p_action: action });
  if (error) fail("advanceFulfillment", error);
}

export async function closeOrder(
  client: SupabaseClient,
  orderId: string,
  expectedVersion: number | null,
  action: "cancel" | "expire",
  reason: string | null,
): Promise<void> {
  const { error } = await client.rpc("expire_or_cancel_order", {
    p_order_id: orderId,
    p_expected_version: expectedVersion,
    p_action: action,
    p_reason: reason,
  });
  if (error) fail("expireOrCancelOrder", error);
}
