import { cookies } from "next/headers";
import { z } from "zod";
import { supabaseRequest } from "@/lib/supabase/transport.server";
import { authenticateDiscussion, AuthTokensSchema, checkWriteOrigin, requireDiscussionDevelopment, setDiscussionCookies } from "@/features/campaign-strategist/discussion-auth.server";
import { discussionApiError, readDiscussionBody } from "@/features/campaign-strategist/discussion-api.server";

export async function POST(request: Request) {
  try {
    requireDiscussionDevelopment(); checkWriteOrigin(request);
    const credentials = z.strictObject({ email: z.email().max(254), password: z.string().min(1).max(256) }).parse(await readDiscussionBody(request));
    const tokens = AuthTokensSchema.parse(await supabaseRequest("/auth/v1/token?grant_type=password", undefined, "POST", credentials));
    await setDiscussionCookies(tokens);
    return Response.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return discussionApiError(error); }
}
export async function GET(request: Request) {
  try { await authenticateDiscussion(request); return Response.json({ authenticated: true }, { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return discussionApiError(error); }
}
export async function DELETE(request: Request) {
  try {
    requireDiscussionDevelopment(); checkWriteOrigin(request);
    const jar = await cookies(); jar.delete("campaign-lab-dev-access"); jar.delete("campaign-lab-dev-refresh");
    return Response.json({ success: true });
  } catch (error) { return discussionApiError(error); }
}
