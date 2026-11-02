import { site } from "@/config/site";

export function Brand({ inverse = false }: { inverse?: boolean }) {
  return (
    <a className={`brand${inverse ? " brand-inverse" : ""}`} href="#beranda" aria-label={`${site.name}, kembali ke awal`}>
      <svg width="32" height="34" viewBox="0 0 32 34" fill="none" aria-hidden="true">
        <path d="M26 8a12 12 0 1 0 0 18" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
        <path d="M17 12v11h9" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span>{site.name}</span>
    </a>
  );
}
