import "server-only";
import { after } from "next/server";
import { loadEmailSender } from "@/features/paid-email/sender.server";
import { runPaidEmailJobs } from "@/features/paid-email/service";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/service-role";

const INLINE_LIMIT = 5;

/**
 * Kirim email lunas setelah respons selesai (kontrak C5 §8: pengiriman sesudah commit). Bila gagal atau provider belum diatur,
 * job tetap mengantre dan diambil lagi oleh route cron. Tidak pernah mengubah hasil pembayaran.
 */
export function schedulePaidEmails(): void {
  after(async () => {
    const sender = loadEmailSender();
    if (sender === null) return;
    try {
      await runPaidEmailJobs(createSupabaseServiceRoleClient(), sender, INLINE_LIMIT);
    } catch (error) {
      console.error("[paid-email] pengiriman setelah pembayaran gagal", { name: error instanceof Error ? error.name : "unknown" });
    }
  });
}
