import "server-only";
import { z } from "zod";
import type { Database } from "./database.types";

type Rpc = Database["public"]["Functions"];
// PostgreSQL permits NULL for the initial CAS token; generated RPC UUID args omit nullability.
type RpcArgs<K extends keyof Rpc> = K extends "record_campaign_evaluation_cas"
  ? Omit<Rpc[K]["Args"], "p_expected_evaluation_id"> & { p_expected_evaluation_id: string | null } : Rpc[K]["Args"];
type Table = keyof Database["public"]["Tables"];
export class SupabaseError extends Error {
  constructor(readonly code: string, readonly detail: string, readonly status: number) { super("Supabase request failed"); }
}
const ErrorSchema = z.object({ code: z.string().optional(), message: z.string().optional() });
export function localSupabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_PUBLISHABLE_KEY;
  if (!url || !key || new URL(url).origin !== "http://127.0.0.1:54321") throw new SupabaseError("CONFIGURATION_ERROR", "LOCAL_ONLY", 503);
  return { url, key };
}
export async function supabaseRequest(path: string, token?: string, method = "GET", body?: unknown): Promise<unknown> {
  const { url, key } = localSupabaseConfig();
  let response: Response;
  try {
    response = await fetch(`${url}${path}`, { method, cache: "no-store", signal: AbortSignal.timeout(12_000),
      headers: { apikey: key, ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": "application/json",
        ...(method === "PATCH" || (method === "POST" && path.startsWith("/rest/v1/") && !path.startsWith("/rest/v1/rpc/")) ? { Prefer: "return=representation" } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  } catch { throw new SupabaseError("PERSISTENCE_UNAVAILABLE", "TRANSPORT", 503); }
  let value: unknown;
  try { value = await response.json(); } catch { throw new SupabaseError("PERSISTENCE_UNAVAILABLE", "INVALID_RESPONSE", 503); }
  if (!response.ok) {
    const error = ErrorSchema.safeParse(value);
    throw new SupabaseError(error.success ? error.data.code ?? "AUTH_ERROR" : "PERSISTENCE_UNAVAILABLE",
      error.success ? error.data.message ?? "" : "", response.status);
  }
  return value;
}
export function supabaseTransport(token: string) {
  return {
    select(table: Table, query: Record<string, string>): Promise<unknown> {
      return supabaseRequest(`/rest/v1/${table}?${new URLSearchParams(query)}`, token);
    },
    update<K extends Table>(table: K, query: Record<string, string>, values: Database["public"]["Tables"][K]["Update"]): Promise<unknown> {
      return supabaseRequest(`/rest/v1/${table}?${new URLSearchParams(query)}`, token, "PATCH", values);
    },
    insert<K extends Table>(table: K, values: Database["public"]["Tables"][K]["Insert"]): Promise<unknown> {
      return supabaseRequest(`/rest/v1/${table}`, token, "POST", values);
    },
    async rpc<K extends keyof Rpc>(name: K, args: RpcArgs<K>): Promise<unknown> {
      try { return await supabaseRequest(`/rest/v1/rpc/${name}`, token, "POST", args); }
      catch (error) {
        // Only a confirmed transaction abort is retried; network outcomes may already have committed.
        if (!(error instanceof SupabaseError) || error.code !== "40001" || !/^could not serialize access/.test(error.detail)) throw error;
        return supabaseRequest(`/rest/v1/rpc/${name}`, token, "POST", args);
      }
    },
  };
}
export type SupabaseTransport = ReturnType<typeof supabaseTransport>;
export function privilegedTransport() {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new SupabaseError("CONFIGURATION_ERROR", "SERVER_KEY_MISSING", 503);
  return supabaseTransport(secret);
}
