import { createHash, timingSafeEqual } from "node:crypto";
import { runExpireJobs } from "@/features/jobs/service";
import { loadEmailSender } from "@/features/paid-email/sender.server";
import { emailContext } from "@/features/paid-email/schedule.server";
import { runPaidEmailJobs } from "@/features/paid-email/service";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/service-role";

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16) return false;
  // Hash dulu agar panjang sama, lalu dibandingkan dengan waktu konstan.
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(request.headers.get("authorization") ?? ""), digest(`Bearer ${secret}`));
}

/**
 * Worker terjadwal (misalnya Vercel Cron dengan header `Authorization: Bearer <CRON_SECRET>`): merapikan pesanan yang lewat tenggat
 * dan mengirim ulang email lunas yang tertunda. Aman diulang dan dijalankan bersamaan.
 */
export async function GET(request: Request): Promise<Response> {
  if (!authorized(request)) return Response.json({ result: "unauthorized" }, { status: 401 });
  const client = createSupabaseServiceRoleClient();
  const expire = await runExpireJobs(client);
  const sender = loadEmailSender();
  const email = sender === null ? "not_configured" : await runPaidEmailJobs(client, sender, undefined, emailContext());
  return Response.json({ expire, email }, { headers: { "Cache-Control": "no-store" } });
}
