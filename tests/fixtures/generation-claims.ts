import { randomUUID } from "node:crypto";
import { z } from "zod";
import { generationClaims } from "../../src/lib/ai/generation-claims.server";
import { SupabaseError, type SupabaseTransport } from "../../src/lib/supabase/transport.server";
import { generationQuotaPolicy } from "../../src/lib/ai/generation-quota-policy.server";

// SQL-transport fixture only: each coordinator instance shares a simulated UNIQUE-key store, never a production mutex.
export function generationClaimFixture(businessId: string, now: () => string) {
  const rows: Record<string, unknown>[] = [];
  const quotaEnv = { RATE_LIMIT_HMAC_KEY: "batch04b-test-only-hmac-secret-00000000" };
  const quota = generationQuotaPolicy(quotaEnv);
  if (!quota.success) throw Error(quota.code);
  const buckets = new Map<string, number>(), ownerUserId = randomUUID();
  function matches(row: Record<string, unknown>, query: Record<string, string>) {
    return Object.entries(query).filter(([key]) => !["select", "limit"].includes(key)).every(([key, value]) => value === `eq.${String(row[key])}`);
  }
  const user: SupabaseTransport = {
    select: async (_table, query) => structuredClone(rows.filter(row => matches(row, query))),
    rpc: async () => true, insert: async () => { throw Error("User insert forbidden"); }, update: async () => { throw Error("User update forbidden"); },
  };
  const server: SupabaseTransport = { ...user,
    async rpc(name, raw) {
      if (name !== "admit_ai_generation") throw Error("Unexpected RPC");
      const args = z.object({ p_business_id: z.uuid(), p_generation_id: z.uuid(), p_generation_type: z.enum(["blueprint", "evaluation", "memory"]),
        p_request_key: z.string(), p_input_hash: z.string(), p_model_id: z.string(), p_preorder_id: z.uuid(),
        p_minute_key_hash: z.string(), p_hour_key_hash: z.string(), p_day_key_hash: z.string(), p_daily_limit: z.number().int().positive() }).parse(raw);
      const existing = rows.find(row => row.business_id === args.p_business_id && row.generation_type === args.p_generation_type && row.request_key === args.p_request_key);
      if (existing) {
        if (existing.preorder_id !== args.p_preorder_id || existing.input_hash !== args.p_input_hash) throw new SupabaseError("40001", "IDEMPOTENCY_CONFLICT", 409);
        return { status: existing.status, generationId: existing.id };
      }
      const windows = quota.windows(args.p_business_id, now());
      const hashes = [args.p_minute_key_hash, args.p_hour_key_hash, args.p_day_key_hash];
      if (windows.some((window, index) => window.keyHash !== hashes[index])) throw Error("Unexpected quota namespace");
      const exhausted = windows.filter(window => (buckets.get(`${window.keyHash}:${window.windowStart}`) ?? 0) >= window.limit);
      if (exhausted[0]) return { status: "denied", window: exhausted.at(-1)?.kind,
        retryAfter: Math.max(...exhausted.map(window => Math.ceil((Date.parse(window.expiresAt) - Date.parse(now())) / 1000))) };
      windows.forEach(window => { const key = `${window.keyHash}:${window.windowStart}`; buckets.set(key, (buckets.get(key) ?? 0) + 1); });
      rows.push({ id: args.p_generation_id, business_id: args.p_business_id, preorder_id: args.p_preorder_id, campaign_id: null, session_id: null,
        generation_type: args.p_generation_type, request_key: args.p_request_key, input_hash: args.p_input_hash, model_id: args.p_model_id,
        status: "running", started_at: now(), output_json: null, error_code: null, finished_at: null });
      return { status: "claimed", generationId: args.p_generation_id };
    },
    async insert(table, values) {
      if (table !== "ai_generations") throw Error("Unexpected table");
      const row = z.record(z.string(), z.unknown()).parse(values);
      if (rows.some(existing => existing.business_id === row.business_id && existing.generation_type === row.generation_type && existing.request_key === row.request_key)) throw new SupabaseError("23505", "duplicate key", 409);
      rows.push(structuredClone(row)); return [structuredClone(row)];
    },
    async update(table, query, values) {
      if (table !== "ai_generations") throw Error("Unexpected table");
      const found = rows.filter(row => matches(row, query)); for (const row of found) Object.assign(row, structuredClone(values)); return structuredClone(found);
    },
  };
  return { rows, buckets, quotaEnv, ownerUserId, user, server,
    instance: () => generationClaims(user, () => server, businessId, now, ownerUserId, quotaEnv) };
}
