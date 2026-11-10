import "server-only";
import { after } from "next/server";
import { loadEmailSender } from "@/features/paid-email/sender.server";
import { runPaidEmailJobs, sendPendingPaymentEmail, type EmailContext } from "@/features/paid-email/service";
import { appUrl, emailLogoUrl } from "@/lib/app-url";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/service-role";

const INLINE_LIMIT = 5;

/** Alamat dasar dan logo untuk email, dari `APP_URL`. */
export function emailContext(orderUrls?: ReadonlyMap<string, string>): EmailContext {
  const base = appUrl();
  return { appUrl: base, logoUrl: emailLogoUrl(base), ...(orderUrls ? { orderUrls } : {}) };
}

/** Tautan halaman pesanan pembeli. Dibangun dari token di memori dan tidak pernah disimpan. */
export function privateOrderUrl(token: string): string | null {
  const base = appUrl();
  return base ? `${base}/o/${encodeURIComponent(token)}` : null;
}

/**
 * Kirim email lunas (dan notifikasi penjual) setelah respons selesai (kontrak C5 §8: pengiriman sesudah commit). Bila gagal atau
 * provider belum diatur, job tetap mengantre dan diambil lagi oleh route cron. Tidak pernah mengubah hasil pembayaran.
 * `orderUrls` diisi bila pemicunya memegang token pembeli, agar email lunas memuat tautan ke halaman pesanannya.
 */
export function schedulePaidEmails(orderUrls?: ReadonlyMap<string, string>): void {
  after(async () => {
    const sender = loadEmailSender();
    if (sender === null) return;
    try {
      await runPaidEmailJobs(createSupabaseServiceRoleClient(), sender, INLINE_LIMIT, emailContext(orderUrls));
    } catch (error) {
      console.error("[paid-email] pengiriman setelah pembayaran gagal", { name: error instanceof Error ? error.name : "unknown" });
    }
  });
}

/** Email "menunggu pembayaran" setelah checkout selesai. Gagal kirim hanya dicatat; pesanan tetap tercatat. */
export function schedulePendingPaymentEmail(orderId: string, token: string): void {
  after(async () => {
    const sender = loadEmailSender();
    if (sender === null) return;
    try {
      await sendPendingPaymentEmail(createSupabaseServiceRoleClient(), sender, orderId, { ...emailContext(), orderUrl: privateOrderUrl(token) });
    } catch (error) {
      console.error("[paid-email] email menunggu pembayaran gagal", { name: error instanceof Error ? error.name : "unknown" });
    }
  });
}
