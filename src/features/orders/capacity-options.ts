import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { formatIdr } from "@/lib/format-idr";
import { formatDateOnly } from "@/lib/wib-time";
import { listCapacities } from "@/features/capacity/repository";
import type { ManualOrderCapacityOption } from "@/features/orders/components/manual-order-form";
import { listProducts } from "@/features/products/repository";

/** Pesanan manual boleh sampai jadwal pengambilan lewat, tidak terikat batas pesan pembeli. Keputusan akhirnya tetap di database. */
export async function listManualOrderCapacityOptions(client: SupabaseClient, businessId: string): Promise<ManualOrderCapacityOption[]> {
  const [capacities, products] = await Promise.all([listCapacities(client, businessId), listProducts(client, businessId)]);
  const activeProducts = new Map(products.filter((product) => product.isActive).map((product) => [product.id, product]));
  const now = Date.now();

  return capacities.flatMap((capacity) => {
    const product = activeProducts.get(capacity.productId);
    if (!product || capacity.availability.available <= 0 || Date.parse(capacity.fulfillmentWindowEndAt) <= now) return [];
    return [
      {
        id: capacity.id,
        label: `${capacity.productName} · ${formatDateOnly(capacity.fulfillmentDate)} · ${formatIdr(product.basePriceIdr)} · sisa ${capacity.availability.available} unit`,
      },
    ];
  });
}
