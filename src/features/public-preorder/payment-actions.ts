"use server";

import { privateOrderTokenSchema } from "@/features/orders/schemas";
import { findOrderIdByTokenHash } from "@/features/paid-email/repository";
import { privateOrderUrl, schedulePaidEmails } from "@/features/paid-email/schedule.server";
import { hashPrivateOrderToken } from "@/features/orders/service";
import { continueQrisPayment, loadMidtransSandbox, type QrisView } from "@/features/payments/qris-checkout.server";
import { takeLimit } from "@/features/public-preorder/rate-limit.server";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/service-role";

export type PaymentPanelView = QrisView | { kind: "not_configured" } | { kind: "failed" } | { kind: "rate_limited" };

/**
 * Tombol bayar dan cek status di halaman pesanan privat. Hanya token yang dikirim browser. Nominal, referensi, dan tenggat
 * dibaca dari database lewat token itu (kontrak C5 §4), jadi browser tidak bisa mengubah tagihan.
 */
export async function continuePaymentAction(token: string, checkStatus: boolean): Promise<PaymentPanelView> {
  if (!privateOrderTokenSchema.safeParse(token).success) return { kind: "not_found" };
  const midtrans = loadMidtransSandbox();
  if (midtrans === null) return { kind: "not_configured" };
  try {
    const client = createSupabaseServiceRoleClient();
    // Cek status memanggil Midtrans, jadi dibatasi per pesanan. Tombol bayar tidak, karena tagihan baru hanya dibuat sekali per pesanan.
    if (checkStatus === true && (await takeLimit(client, "paymentCheck", token)) === "limited") return { kind: "rate_limited" };
    const view = await continueQrisPayment(client, midtrans.gateway, token, { checkStatus: checkStatus === true });
    // Status final baru diterapkan, mungkin lunas. Bila bukan, worker tidak menemukan job dan tidak mengirim apa pun.
    // Pembayaran baru saja diterapkan oleh request ini, yang memegang token pembeli: email lunas ikut membawa tautan pesanannya.
    if (view.kind === "updated") {
      const orderId = await findOrderIdByTokenHash(client, hashPrivateOrderToken(token));
      const orderUrl = privateOrderUrl(token);
      schedulePaidEmails(orderId && orderUrl ? new Map([[orderId, orderUrl]]) : undefined);
    }
    return view;
  } catch (error) {
    // Hanya nama galat. Token dan data pembeli tidak boleh masuk log.
    console.error("[payments] continueQrisPayment gagal", { name: error instanceof Error ? error.name : "unknown" });
    return { kind: "failed" };
  }
}
