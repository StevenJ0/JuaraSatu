import "server-only";
import { createHmac } from "node:crypto";
import { z } from "zod";

const Environment = z.object({
  AI_DAILY_GENERATION_LIMIT: z.string().regex(/^[1-9]\d{0,9}$/).default("100").transform(Number).pipe(z.number().int().max(2_147_483_647)),
  RATE_LIMIT_HMAC_KEY: z.string().min(32).max(4096).refine(value => value.trim().length >= 32),
});
const MINUTE = 60_000, HOUR = 60 * MINUTE, DAY = 24 * HOUR, WIB_OFFSET = 7 * HOUR;

// The RPC computes windows from PostgreSQL time; this policy supplies only trusted caps and HMAC namespaces.
export function generationQuotaPolicy(env: { AI_DAILY_GENERATION_LIMIT?: string; RATE_LIMIT_HMAC_KEY?: string }) {
  const parsed = Environment.safeParse(env);
  if (!parsed.success) return { success: false as const, code: "AI_QUOTA_CONFIGURATION_REQUIRED" as const };
  const { AI_DAILY_GENERATION_LIMIT: dailyLimit, RATE_LIMIT_HMAC_KEY: secret } = parsed.data;
  return { success: true as const, dailyLimit, timezone: "Asia/Jakarta" as const,
    windows(businessId: string, at: string) {
      const business = z.uuid().parse(businessId).toLowerCase(); const timestamp = Date.parse(z.iso.datetime({ offset: true }).parse(at));
      return ([{ kind: "minute", limit: 6, duration: MINUTE, offset: 0 }, { kind: "hour", limit: 30, duration: HOUR, offset: 0 },
        { kind: "day", limit: dailyLimit, duration: DAY, offset: WIB_OFFSET }] as const).map(window => {
        const start = Math.floor((timestamp + window.offset) / window.duration) * window.duration - window.offset;
        return { kind: window.kind, limit: window.limit,
          keyHash: createHmac("sha256", secret).update(`campaign-lab:text-generation:quota:v1:${business}:${window.kind}`).digest("hex"),
          windowStart: new Date(start).toISOString(), expiresAt: new Date(start + window.duration).toISOString() };
      });
    },
  };
}
