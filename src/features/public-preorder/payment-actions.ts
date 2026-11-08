"use server";

import { privateOrderTokenSchema } from "@/features/orders/schemas";
import { continueQrisPayment, loadMidtransSandbox, type QrisView } from "@/features/payments/qris-checkout.server";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/service-role";

export type PaymentPanelView = QrisView | { kind: "not_configured" } | { kind: "failed" };

/**
 * Tombol bayar dan cek status di halaman pesanan privat. Hanya token yang dikirim browser. Nominal, referensi, dan tenggat
 * dibaca dari database lewat token itu (kontrak C5 §4), jadi browser tidak bisa mengubah tagihan.
 */
export async function continuePaymentAction(token: string, checkStatus: boolean): Promise<PaymentPanelView> {
  if (!privateOrderTokenSchema.safeParse(token).success) return { kind: "not_found" };
  const midtrans = loadMidtransSandbox();
  if (midtrans === null) return { kind: "not_configured" };
  try {
    return await continueQrisPayment(createSupabaseServiceRoleClient(), midtrans.gateway, token, { checkStatus: checkStatus === true });
  } catch (error) {
    // Hanya nama galat. Token dan data pembeli tidak boleh masuk log.
    console.error("[payments] continueQrisPayment gagal", { name: error instanceof Error ? error.name : "unknown" });
    return { kind: "failed" };
  }
}
