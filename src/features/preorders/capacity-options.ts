import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { formatIdr } from "@/lib/format-idr";
import { formatDateOnly, formatWibDateTime } from "@/lib/wib-time";
import { listCapacities } from "@/features/capacity/repository";
import { listProducts } from "@/features/products/repository";
import type { PreorderCapacityOption } from "@/features/preorders/components/preorder-form";

/** Jadwal yang bisa dipilih: produk aktif, ada kapasitas, dan batas pesan belum lewat. Pilihan draf saat ini selalu ikut. */
export async function listPreorderCapacityOptions(
  client: SupabaseClient,
  businessId: string,
  currentCapacityId?: string,
): Promise<PreorderCapacityOption[]> {
  const [capacities, products] = await Promise.all([listCapacities(client, businessId), listProducts(client, businessId)]);
  const activeProducts = new Map(products.filter((product) => product.isActive).map((product) => [product.id, product]));
  const now = Date.now();

  return capacities.flatMap((capacity) => {
    const product = activeProducts.get(capacity.productId);
    const isOpen = Boolean(product) && capacity.totalUnits > 0 && Date.parse(capacity.intakeCutoffAt) > now;
    if (!isOpen && capacity.id !== currentCapacityId) return [];
    return [
      {
        id: capacity.id,
        label: `${capacity.productName} · ${formatDateOnly(capacity.fulfillmentDate)}`,
        priceLabel: product ? formatIdr(product.basePriceIdr) : "produk nonaktif",
        cutoffLabel: formatWibDateTime(capacity.intakeCutoffAt),
        availableUnits: capacity.availability.available,
      },
    ];
  });
}
