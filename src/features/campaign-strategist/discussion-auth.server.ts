import "server-only";
import { cookies } from "next/headers";
import { z } from "zod";
import { supabaseRequest, supabaseTransport, SupabaseError, type SupabaseTransport } from "@/lib/supabase/transport.server";
import { developmentEnabled } from "./development-provider";
import type { DiscussionScope } from "./discussion-repository";

export class DiscussionHttpError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); }
}
export function requireDiscussionDevelopment() {
  if (process.env.NODE_ENV !== "development") throw new DiscussionHttpError(404, "NOT_FOUND");
  if (!developmentEnabled(process.env)) throw new DiscussionHttpError(503, "CONFIGURATION_ERROR");
}
export function checkWriteOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const bearer = /^Bearer \S+$/i.test(request.headers.get("authorization") ?? "");
  if (origin ? origin !== new URL(request.url).origin : !bearer) throw new DiscussionHttpError(403, "FORBIDDEN");
}
export const AuthTokensSchema = z.object({ access_token: z.string().min(1), refresh_token: z.string().min(1), expires_in: z.number().int().positive() });
export async function setDiscussionCookies(tokens: z.infer<typeof AuthTokensSchema>) {
  const jar = await cookies();
  const options = { httpOnly: true, sameSite: "strict", secure: false, path: "/" } as const;
  jar.set("campaign-lab-dev-access", tokens.access_token, { ...options, maxAge: Math.min(tokens.expires_in, 3600) });
  jar.set("campaign-lab-dev-refresh", tokens.refresh_token, { ...options, maxAge: 86400 });
}
export async function authenticateDiscussion(request: Request) {
  requireDiscussionDevelopment();
  const jar = await cookies(); const authorization = request.headers.get("authorization");
  let token = authorization?.match(/^Bearer (.+)$/i)?.[1] ?? jar.get("campaign-lab-dev-access")?.value;
  let value: unknown;
  try { if (!token) throw new Error("Missing token"); value = await supabaseRequest("/auth/v1/user", token); }
  catch (error) {
    if (error instanceof SupabaseError && error.status >= 500) throw error;
    const refresh = !authorization && jar.get("campaign-lab-dev-refresh")?.value;
    if (!refresh) throw new DiscussionHttpError(401, "UNAUTHENTICATED");
    try {
      const tokens = AuthTokensSchema.parse(await supabaseRequest("/auth/v1/token?grant_type=refresh_token", undefined, "POST", { refresh_token: refresh }));
      await setDiscussionCookies(tokens); token = tokens.access_token; value = await supabaseRequest("/auth/v1/user", token);
    } catch { throw new DiscussionHttpError(401, "UNAUTHENTICATED"); }
  }
  const identity = z.object({ id: z.uuid() }).parse(value);
  if (!token) throw new DiscussionHttpError(401, "UNAUTHENTICATED");
  const user = supabaseTransport(token);
  const members = z.array(z.object({ business_id: z.uuid(), user_id: z.uuid(), role: z.literal("owner") })).parse(
    await user.select("business_members", { select: "business_id,user_id,role", user_id: `eq.${identity.id}`, limit: "1" }));
  const member = members[0];
  if (!member || member.user_id !== identity.id) throw new DiscussionHttpError(403, "FORBIDDEN");
  return { user, ownerUserId: identity.id, businessId: member.business_id };
}
export type DiscussionOwner = Awaited<ReturnType<typeof authenticateDiscussion>>;
const ScopeRowSchema = z.object({ id: z.uuid(), business_id: z.uuid(), preorder_id: z.uuid() });
export async function ownedSession(owner: DiscussionOwner, sessionId: string): Promise<DiscussionScope> {
  const rows = z.array(ScopeRowSchema).parse(await owner.user.select("campaign_ai_sessions", {
    select: "id,business_id,preorder_id", id: `eq.${sessionId}`, business_id: `eq.${owner.businessId}`, limit: "1" }));
  if (!rows[0]) throw new DiscussionHttpError(404, "NOT_FOUND");
  await ownedPreorder(owner.user, owner.businessId, rows[0].preorder_id);
  return { ownerUserId: owner.ownerUserId, businessId: owner.businessId, preorderId: rows[0].preorder_id, sessionId: rows[0].id };
}
export async function ownedPreorder(user: SupabaseTransport, businessId: string, preorderId: string) {
  const rows = z.array(z.object({ id: z.uuid() })).parse(await user.select("preorders", {
    select: "id", id: `eq.${preorderId}`, business_id: `eq.${businessId}`, limit: "1" }));
  if (!rows[0]) throw new DiscussionHttpError(404, "NOT_FOUND");
}
