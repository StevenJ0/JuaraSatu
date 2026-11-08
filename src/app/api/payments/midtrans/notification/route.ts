import { handleMidtransNotification, loadMidtransSandbox } from "@/features/payments/qris-checkout.server";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/service-role";

/** Webhook Midtrans Sandbox. Daftarkan URL publik route ini di dashboard Sandbox tim; localhost tidak bisa dihubungi Midtrans. */
export async function POST(request: Request): Promise<Response> {
  const midtrans = loadMidtransSandbox();
  if (midtrans === null) return Response.json({ result: "not_configured" }, { status: 503 });
  // Tolak sebelum membaca body. Notifikasi QRIS jauh di bawah batas ini.
  if (Number(request.headers.get("content-length") ?? "0") > 65_536) return Response.json({ result: "too_large" }, { status: 413 });
  const result = await handleMidtransNotification(createSupabaseServiceRoleClient(), midtrans.gateway, midtrans.config, await request.text());
  // Isi notifikasi tidak dicatat: bisa memuat data pembeli.
  if (result.status >= 400) console.warn("[midtrans] notifikasi ditolak", { status: result.status, result: result.body.result });
  return Response.json(result.body, { status: result.status, headers: { "Cache-Control": "no-store" } });
}
