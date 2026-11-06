import { site } from "@/config/site";

export function Brand({ inverse = false, href = "#beranda" }: { inverse?: boolean; href?: string }) {
  return (
    <a className={`brand${inverse ? " brand-inverse" : ""}`} href={href} aria-label={`${site.name}, kembali ke awal`}>
      {/* Medali angka satu, sesuai nama Juara Satu. */}
      <svg width="32" height="34" viewBox="0 0 32 34" fill="none" aria-hidden="true">
        <path d="M11.5 21.5 8.5 31.5M20.5 21.5l3 10" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" />
        <circle cx="16" cy="13" r="10" stroke="currentColor" strokeWidth="3.5" />
        <path d="M13.5 10.5 16.8 8v10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span>{site.name}</span>
    </a>
  );
}
