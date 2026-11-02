import { randomSlugSuffix, slugify } from "@/features/business/slug";

const SKU_BASE_MAX_LENGTH = 40;
const FALLBACK_BASE = "produk";

/** SKU dari nama produk agar owner tidak perlu menyusun kode; keunikan final dijaga UNIQUE(business_id, sku). */
export function createProductSku(name: string, suffix: string = randomSlugSuffix()): string {
  return `${slugify(name, SKU_BASE_MAX_LENGTH, FALLBACK_BASE)}-${suffix}`.toUpperCase();
}
