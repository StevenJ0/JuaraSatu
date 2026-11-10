import { site } from "@/config/site";

/**
 * Maskot dan tulisan juarasatu. Gambarnya dipakai sebagai mask, jadi warnanya mengikuti `color` (hijau brand, atau putih
 * dengan `inverse`). Sumber: public/logo.png dan public/tulisan.png, versi web di public/brand.
 */
export function Brand({ inverse = false, href = "#beranda", size = "md" }: { inverse?: boolean; href?: string; size?: "sm" | "md" }) {
  return (
    <a
      className={`brand brand-${size}${inverse ? " brand-inverse" : ""}`}
      href={href}
      aria-label={`${site.name}, kembali ke awal`}
    >
      <span className="brand-mascot" aria-hidden="true" />
      <span className="brand-wordmark" aria-hidden="true" />
    </a>
  );
}
