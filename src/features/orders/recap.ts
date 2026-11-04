import { isPaymentOverdue, nextOrderStep, type OrderStatusFacts } from "@/features/orders/status";

type RecapOrder = OrderStatusFacts & { quantity: number };

export type OrderRecap = {
  /** Sudah pasti dibuat: pesanan berjalan yang belum siap. Pesanan batal dan yang belum dibayar pembeli tidak dihitung. */
  unitsToProduce: number;
  unitsReady: number;
  unitsFulfilled: number;
  ordersNeedingAction: number;
};

export function summarizeOrders(orders: readonly RecapOrder[], now: Date): OrderRecap {
  const recap: OrderRecap = { unitsToProduce: 0, unitsReady: 0, unitsFulfilled: 0, ordersNeedingAction: 0 };

  for (const order of orders) {
    const isClosed = order.orderStatus === "expired" || order.orderStatus === "cancelled" || isPaymentOverdue(order, now);
    if (isClosed) continue;

    const step = nextOrderStep(order);
    if (step?.action === "mark_paid" || step?.action === "confirm" || order.orderStatus === "requires_review") recap.ordersNeedingAction += 1;

    if (order.fulfillmentStatus === "fulfilled") recap.unitsFulfilled += order.quantity;
    else if (order.fulfillmentStatus === "ready") recap.unitsReady += order.quantity;
    else if (order.orderStatus !== "pending_payment") recap.unitsToProduce += order.quantity;
  }
  return recap;
}
