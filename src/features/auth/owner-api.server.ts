import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { supabaseTransport } from "@/lib/supabase/transport.server";
import { findOwnedBusinessId } from "@/features/business/repository";
import { DiscussionHttpError } from "@/features/campaign-strategist/discussion-auth.server";

export async function authenticateOwnerApi() {
  const client = await createSupabaseServerClient();
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) throw new DiscussionHttpError(401, "UNAUTHENTICATED");
  const businessId = await findOwnedBusinessId(client, data.user.id);
  if (!businessId) throw new DiscussionHttpError(403, "BUSINESS_REQUIRED");
  const session = await client.auth.getSession();
  if (!session.data.session) throw new DiscussionHttpError(401, "UNAUTHENTICATED");
  return { client, businessId, ownerUserId: data.user.id, user: supabaseTransport(session.data.session.access_token) };
}
export function requireOwnerOrigin(request: Request) {
  const publicUrl = new URL(request.url);
  // Next may use localhost internally while the browser correctly sends the public Host.
  publicUrl.host = request.headers.get("host") ?? publicUrl.host;
  if (request.headers.get("origin") !== publicUrl.origin) throw new DiscussionHttpError(403, "FORBIDDEN");
}
