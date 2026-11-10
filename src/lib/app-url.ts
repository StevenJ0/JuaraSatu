import { z } from "zod";

/**
 * Alamat dasar aplikasi untuk tautan dan gambar di email (`APP_URL`, misalnya http://localhost:3001 atau domain deploy).
 * Null bila belum diisi: email tetap terkirim, hanya tanpa tombol tautan dan logo.
 */
export function appUrl(source: Record<string, string | undefined> = process.env): string | null {
  const parsed = z.url({ protocol: /^https?$/ }).safeParse(source.APP_URL?.trim());
  return parsed.success ? parsed.data.replace(/\/+$/, "") : null;
}

/** Logo untuk header email. Nama berkasnya memakai spasi, jadi di-encode agar tetap valid sebagai URL. */
export function emailLogoUrl(base: string | null): string | null {
  return base ? `${base}/${encodeURIComponent("logo full.png")}` : null;
}
