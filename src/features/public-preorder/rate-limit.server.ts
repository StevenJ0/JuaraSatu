import "server-only";
import { createHmac } from "node:crypto";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Pembatas untuk aksi pembeli tanpa akun, memakai `take_rate_limit` yang sudah ada di schema (penghitung atomik per jendela waktu).
 * Kunci di database adalah HMAC, jadi IP dan token pembeli tidak pernah tersimpan mentah.
 */
export const LIMITS = {
  // Kirim ulang setelah respons hilang ikut terhitung, jadi batasnya longgar untuk pembeli biasa tapi menghentikan spam penahan kuota.
  checkout: { max: 6, windowSeconds: 600 },
  // Cek status memanggil Midtrans. Polling halaman tidak memakai ini, hanya tombol cek status.
  paymentCheck: { max: 10, windowSeconds: 600 },
} as const;
export type LimitName = keyof typeof LIMITS;

export type LimitDecision = "allowed" | "limited" | "disabled";

const keySchema = z.string().min(32);

/** Jendela tetap: awal jendela dibulatkan ke bawah, sehingga semua permintaan di jendela yang sama memakai satu baris penghitung. */
export function limitWindow(windowSeconds: number, now: Date): { start: string; expires: string } {
  const size = windowSeconds * 1000;
  const start = Math.floor(now.getTime() / size) * size;
  return { start: new Date(start).toISOString(), expires: new Date(start + size).toISOString() };
}

export function limitKeyHash(secret: string, name: LimitName, subject: string): string {
  return createHmac("sha256", secret).update(`${name}:${subject}`).digest("hex");
}

/**
 * `disabled` bila `RATE_LIMIT_HMAC_KEY` belum diisi: checkout tetap jalan dan peringatan dicatat. Galat database ikut `disabled`,
 * karena pembatas ini pelindung tambahan, sedangkan aturan kuota dan pembayaran tetap dijaga database.
 */
export async function takeLimit(client: SupabaseClient, name: LimitName, subject: string, now: Date = new Date(),
  secret: string | undefined = process.env.RATE_LIMIT_HMAC_KEY): Promise<LimitDecision> {
  const key = keySchema.safeParse(secret);
  if (!key.success) {
    console.warn("[rate-limit] RATE_LIMIT_HMAC_KEY belum diisi, pembatas checkout tidak aktif");
    return "disabled";
  }
  const { max, windowSeconds } = LIMITS[name];
  const window = limitWindow(windowSeconds, now);
  const { data, error } = await client.rpc("take_rate_limit", {
    p_key_hash: limitKeyHash(key.data, name, subject),
    p_window_start: window.start,
    p_expires_at: window.expires,
    p_limit: max,
  });
  if (error) {
    console.error("[rate-limit] take_rate_limit gagal", { code: error.code });
    return "disabled";
  }
  return z.boolean().parse(data) ? "allowed" : "limited";
}

/** IP pertama dari `x-forwarded-for` (diisi platform hosting), lalu `x-real-ip`. Tanpa keduanya semua permintaan berbagi satu kunci. */
export function clientAddress(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || headers.get("x-real-ip")?.trim() || "unknown";
}
