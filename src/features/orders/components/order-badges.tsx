import { Badge } from "@/components/owner/badge";
import { orderBadge, paymentBadge, type OrderStatusFacts } from "@/features/orders/status";

/** Status pesanan dan pembayaran selalu terpisah, pembayaran di kanan. */
export function OrderBadges({ order, now }: { order: OrderStatusFacts; now: Date }) {
  const status = orderBadge(order, now);
  const payment = paymentBadge(order, now);
  return (
    <span className="flex flex-wrap items-center gap-2">
      <Badge tone={status.tone}>{status.label}</Badge>
      <Badge tone={payment.tone}>{payment.label}</Badge>
    </span>
  );
}
