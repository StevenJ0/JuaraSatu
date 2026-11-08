import type { CostQuality } from "@/features/products/schemas";
import type { CapacityAvailability } from "@/features/capacity/availability";
import type { Preorder } from "@/features/preorders/repository";

/**
 * Kontrak C1: dua bentuk data preorder untuk modul lain. Field disebut satu per satu, bukan menyalin baris database,
 * agar biaya, data pelanggan, dan token tidak bisa ikut terbawa saat kolom baru ditambahkan.
 */

export type PublicPreorderAvailability = "open" | "not_started" | "closed" | "sold_out";

/** Untuk halaman pembeli yang dibuka tanpa login. Hanya preorder yang pernah terbit yang punya bentuk ini. */
export type PublicPreorder = {
  slug: string;
  name: string;
  availability: PublicPreorderAvailability;
  /** Jumlah yang bisa dipesan saat ini. Selalu 0 bila `availability` bukan `open`. */
  orderableUnits: number;
  /** Harga setelah diskon penawaran aktif. Kirim sebagai `expectedUnitPriceIdr` ke `placePublicOrder`. */
  unitPriceIdr: number;
  /** Harga sebelum diskon. Sama dengan `unitPriceIdr` bila tidak ada penawaran aktif. */
  basePriceIdr: number;
  discountBps: number;
  fulfillmentDate: string;
  startsAt: string;
  endsAt: string;
  intakeCutoffAt: string;
  fulfillmentWindowEndAt: string;
  businessName: string;
  product: { name: string; description: string | null; photoUrl: string | null; thumbnailUrl: string | null };
  /** Ketentuan yang dibekukan saat terbit, sehingga tidak berubah walau profil usaha diubah. */
  pickup: { instructions: string; publicContact: string | null };
  version: number;
  asOf: string;
};

type AvailabilityFacts = {
  status: "published" | "closed" | "completed";
  startsAt: string;
  endsAt: string;
  intakeCutoffAt: string;
  orderableUnits: number;
};

/** Mengikuti urutan cek `create_preorder_order`. Ini hanya untuk tampilan; keputusan akhir tetap di database saat memesan. */
export function resolvePublicAvailability(facts: AvailabilityFacts, now: Date): PublicPreorderAvailability {
  if (facts.status !== "published") return "closed";
  const time = now.getTime();
  if (time < Date.parse(facts.startsAt)) return "not_started";
  if (time >= Date.parse(facts.endsAt) || time >= Date.parse(facts.intakeCutoffAt)) return "closed";
  return facts.orderableUnits > 0 ? "open" : "sold_out";
}

export function toPublicPreorder(
  facts: AvailabilityFacts & Omit<PublicPreorder, "availability" | "asOf">,
  now: Date,
): PublicPreorder {
  const availability = resolvePublicAvailability(facts, now);
  return {
    slug: facts.slug,
    name: facts.name,
    availability,
    orderableUnits: availability === "open" ? facts.orderableUnits : 0,
    unitPriceIdr: facts.unitPriceIdr,
    basePriceIdr: facts.basePriceIdr,
    discountBps: facts.discountBps,
    fulfillmentDate: facts.fulfillmentDate,
    startsAt: facts.startsAt,
    endsAt: facts.endsAt,
    intakeCutoffAt: facts.intakeCutoffAt,
    fulfillmentWindowEndAt: facts.fulfillmentWindowEndAt,
    businessName: facts.businessName,
    product: {
      name: facts.product.name,
      description: facts.product.description,
      photoUrl: facts.product.photoUrl,
      thumbnailUrl: facts.product.thumbnailUrl,
    },
    pickup: { instructions: facts.pickup.instructions, publicContact: facts.pickup.publicContact },
    version: facts.version,
    asOf: now.toISOString(),
  };
}

/** Projection C1 privat untuk owner; tidak digunakan oleh halaman publik. */
export type PreorderContext = {
  business: { id: string; name: string; categories: string[]; description: string | null };
  product: { id: string; name: string; description: string | null; basePriceIdr: number; catalogPriceIdr: number;
    variableCostIdr: number | null; costQuality: CostQuality; isActive: boolean; version: number };
  capacity: { id: string; version: number; totalUnits: number; availability: CapacityAvailability };
  preorder: {
    id: string;
    itemId: string;
    itemVersion: number;
    name: string;
    status: Preorder["status"];
    fulfillmentDate: string;
    startsAt: string;
    endsAt: string;
    intakeCutoffAt: string;
    fulfillmentWindowEndAt: string;
    targetUnits: number;
    quotaUnits: number;
    version: number;
  };
  units: { paid: number; allocated: number; held: number; orderable: number; paidTargetGap: number };
  asOf: string;
};

export function toPreorderContext(
  preorder: Preorder,
  business: PreorderContext["business"],
  product: Pick<PreorderContext["product"], "description" | "costQuality" | "isActive" | "variableCostIdr" | "catalogPriceIdr" | "version">,
  source: { itemId: string; itemVersion: number; capacity: PreorderContext["capacity"] },
  now: Date,
): PreorderContext {
  return {
    business: { id: business.id, name: business.name, categories: business.categories, description: business.description },
    product: {
      id: preorder.productId,
      name: preorder.productName,
      description: product.description,
      basePriceIdr: preorder.basePriceIdr,
      costQuality: product.costQuality,
      isActive: product.isActive,
      variableCostIdr: product.variableCostIdr,
      catalogPriceIdr: product.catalogPriceIdr,
      version: product.version,
    },
    capacity: source.capacity,
    preorder: {
      id: preorder.id,
      itemId: source.itemId,
      itemVersion: source.itemVersion,
      name: preorder.name,
      status: preorder.status,
      fulfillmentDate: preorder.fulfillmentDate,
      startsAt: preorder.startsAt,
      endsAt: preorder.endsAt,
      intakeCutoffAt: preorder.intakeCutoffAt,
      fulfillmentWindowEndAt: preorder.fulfillmentWindowEndAt,
      targetUnits: preorder.targetUnits,
      quotaUnits: preorder.quotaUnits,
      version: preorder.version,
    },
    units: {
      paid: preorder.metrics.paidUnits,
      allocated: preorder.metrics.quotaUsage.allocated,
      held: preorder.metrics.quotaUsage.effectiveHeld,
      orderable: preorder.metrics.orderableUnits,
      paidTargetGap: preorder.metrics.paidTargetGap,
    },
    asOf: now.toISOString(),
  };
}
