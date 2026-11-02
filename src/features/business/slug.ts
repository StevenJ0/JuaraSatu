const SLUG_MAX_LENGTH = 140;
const SUFFIX_LENGTH = 6;
const SUFFIX_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const FALLBACK_BASE = "usaha";

/** Mengubah teks bebas menjadi potongan URL lowercase yang hanya berisi a-z, 0-9, dan tanda hubung. */
export function slugify(text: string, maxLength: number): string {
  const slug = text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLength)
    .replace(/-+$/g, "");
  return slug || FALLBACK_BASE;
}

export function randomSlugSuffix(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(SUFFIX_LENGTH));
  return Array.from(bytes, (byte) => SUFFIX_ALPHABET[byte % SUFFIX_ALPHABET.length]).join("");
}

/**
 * Slug business unik global (schema v2.1 §4.2). Akhiran acak mencegah tabrakan antar-UMKM dengan nama sama
 * dan membuat slug tidak mudah ditebak; keunikan final tetap dijaga UNIQUE(slug) di database.
 */
export function createBusinessSlug(name: string, suffix: string = randomSlugSuffix()): string {
  const base = slugify(name, SLUG_MAX_LENGTH - suffix.length - 1);
  return `${base}-${suffix}`;
}
