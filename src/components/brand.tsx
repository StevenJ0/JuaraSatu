import { site } from "@/config/site";

export function Brand({ inverse = false }: { inverse?: boolean }) {
  return (
    <a className={`brand${inverse ? " brand-inverse" : ""}`} href="#beranda" aria-label={`${site.name}, kembali ke awal`}>
      <svg width="31" height="34" viewBox="0 0 31 34" fill="none" aria-hidden="true">
        <path d="M5 4h22v15c0 8-5 12-12 12C8 31 4 28 3 23" stroke="currentColor" strokeWidth="5" strokeLinecap="round" />
        <path d="M16 4v15c0 3-1 5-4 5" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
      </svg>
      <span>{site.name}</span>
    </a>
  );
}
