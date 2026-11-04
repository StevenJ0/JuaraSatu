import type { BadgeTone } from "@/components/owner/badge";
import type { OrderAction } from "@/features/orders/schemas";

export type OrderStatus = "pending_payment" | "awaiting_confirmation" | "active" | "expired" | "cancelled" | "requires_review";
export type FulfillmentStatus = "pending_confirmation" | "confirmed" | "in_production" | "ready" | "fulfilled" | "cancelled";
export type ExternalPaymentStatus = "unpaid" | "confirmed" | "voided";

export type OrderStatusFacts = {
  orderStatus: OrderStatus;
  fulfillmentStatus: FulfillmentStatus;
  externalPaymentStatus: ExternalPaymentStatus | null;
  paymentDueAt: string | null;
};

export type StatusBadge = { label: string; tone: BadgeTone };

/** Tenggat lewat tapi belum dilepas tetap tampil kedaluwarsa, karena slotnya memang sudah tidak ditahan (PRD §9.2). */
export function isPaymentOverdue(order: OrderStatusFacts, now: Date): boolean {
  return order.orderStatus === "pending_payment" && order.paymentDueAt !== null && Date.parse(order.paymentDueAt) <= now.getTime();
}

const FULFILLMENT_BADGES: Record<FulfillmentStatus, StatusBadge> = {
  pending_confirmation: { label: "Perlu dikonfirmasi", tone: "warning" },
  confirmed: { label: "Dikonfirmasi", tone: "neutral" },
  in_production: { label: "Diproduksi", tone: "neutral" },
  ready: { label: "Siap diambil", tone: "neutral" },
  fulfilled: { label: "Selesai", tone: "success" },
  cancelled: { label: "Dibatalkan", tone: "danger" },
};

export function orderBadge(order: OrderStatusFacts, now: Date): StatusBadge {
  if (order.orderStatus === "expired" || isPaymentOverdue(order, now)) return { label: "Kedaluwarsa", tone: "danger" };
  if (order.orderStatus === "cancelled") return { label: "Dibatalkan", tone: "danger" };
  if (order.orderStatus === "requires_review") return { label: "Perlu ditinjau", tone: "danger" };
  if (order.orderStatus === "pending_payment") return { label: "Menunggu pembayaran", tone: "neutral" };
  return FULFILLMENT_BADGES[order.fulfillmentStatus];
}

export function paymentBadge(order: OrderStatusFacts, now: Date): StatusBadge {
  if (order.externalPaymentStatus === "confirmed") return { label: "Lunas (manual)", tone: "success" };
  if (order.externalPaymentStatus === "voided") return { label: "Tidak ditagih", tone: "neutral" };
  if (order.externalPaymentStatus === "unpaid") return { label: "Menunggu bayar", tone: "warning" };

  if (order.orderStatus === "expired" || isPaymentOverdue(order, now)) return { label: "Kedaluwarsa", tone: "danger" };
  if (order.orderStatus === "pending_payment") return { label: "Menunggu bayar", tone: "warning" };
  if (order.orderStatus === "cancelled") return { label: "Tidak ditagih", tone: "neutral" };
  // Pesanan pembeli hanya melewati `pending_payment` setelah pembayaran terverifikasi (R5).
  return { label: "Lunas (sandbox)", tone: "success" };
}

export type NextOrderStep = { action: OrderAction; label: string };

/** Langkah berikutnya untuk pemilik. Null berarti menunggu pihak lain atau pesanan sudah berakhir. */
export function nextOrderStep(order: OrderStatusFacts): NextOrderStep | null {
  if (order.orderStatus === "expired" || order.orderStatus === "cancelled" || order.orderStatus === "pending_payment") return null;
  if (order.externalPaymentStatus === "unpaid") return { action: "mark_paid", label: "Tandai lunas" };
  if (order.orderStatus === "awaiting_confirmation") return { action: "confirm", label: "Konfirmasi pesanan" };
  if (order.orderStatus !== "active") return null;
  if (order.fulfillmentStatus === "confirmed") return { action: "start_production", label: "Mulai produksi" };
  if (order.fulfillmentStatus === "in_production") return { action: "mark_ready", label: "Tandai siap" };
  if (order.fulfillmentStatus === "ready") return { action: "fulfill", label: "Tandai diambil" };
  return null;
}

export function canCancelOrder(order: OrderStatusFacts): boolean {
  return order.orderStatus !== "expired" && order.orderStatus !== "cancelled" && order.fulfillmentStatus !== "fulfilled";
}

/** Setelah produksi mulai, slot dan biaya tetap ada walau dibatalkan (PRD §Cancel after production). */
export function cancelWillReleaseSlot(order: OrderStatusFacts): boolean {
  return order.fulfillmentStatus === "pending_confirmation" || order.fulfillmentStatus === "confirmed";
}

export const ORDER_FILTERS = [
  { value: "all", label: "Semua" },
  { value: "attention", label: "Perlu tindakan" },
  { value: "running", label: "Berjalan" },
  { value: "done", label: "Selesai" },
  { value: "closed", label: "Batal" },
] as const;
export type OrderFilter = (typeof ORDER_FILTERS)[number]["value"];

export function toOrderFilter(value: unknown): OrderFilter {
  return ORDER_FILTERS.find((filter) => filter.value === value)?.value ?? "all";
}

export function matchesOrderFilter(order: OrderStatusFacts, filter: OrderFilter, now: Date): boolean {
  if (filter === "all") return true;
  const isClosed = order.orderStatus === "expired" || order.orderStatus === "cancelled" || isPaymentOverdue(order, now);
  if (filter === "closed") return isClosed;
  if (isClosed) return false;
  if (filter === "done") return order.fulfillmentStatus === "fulfilled";
  const needsOwner =
    order.orderStatus === "requires_review" || order.orderStatus === "awaiting_confirmation" || order.externalPaymentStatus === "unpaid";
  if (filter === "attention") return needsOwner;
  return !needsOwner && order.fulfillmentStatus !== "fulfilled";
}
