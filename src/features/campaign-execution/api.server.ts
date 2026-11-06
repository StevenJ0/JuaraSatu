import "server-only";
import { z } from "zod";
import { authenticateDiscussion, checkWriteOrigin } from "../campaign-strategist/discussion-auth.server";
import { discussionApiError, readDiscussionBody } from "../campaign-strategist/discussion-api.server";
import { seededDevelopmentContext } from "../campaign-strategist/development-context.server";
import { blueprintRepository } from "../campaign-blueprint/repository.server";
import { BlueprintError } from "../campaign-blueprint/contracts";
import { privilegedTransport } from "@/lib/supabase/transport.server";
import { CampaignExecutionError, PublishCampaignCommandSchema, CloseCampaignCommandSchema, TaskCommandSchema } from "./contracts";
import { executionRepository, executionDatabaseError } from "./repository.server";
import { campaignExecutionService } from "./service";
import { readPublishedOffer } from "./published-offer.server";

async function boundary(request: Request) {
  const owner = await authenticateDiscussion(request);
  if (process.env.CAMPAIGN_EXECUTION_MODE !== "synthetic") throw new CampaignExecutionError("SYNTHETIC_PUBLISHING_DISABLED", 503);
  const now = () => new Date().toISOString(); const repository = executionRepository(owner.user, privilegedTransport, owner);
  const source = blueprintRepository(owner.user, privilegedTransport, owner); const seeded = seededDevelopmentContext(owner.user, process.env, now);
  const service = campaignExecutionService(repository, { now, publishingEnabled: true, selection: source.selection, databaseError: executionDatabaseError,
    loadContext: async (scope) => { try { return await seeded(scope); } catch { throw new CampaignExecutionError("CONTEXT_UNAVAILABLE", 503); } } });
  return { owner, now, repository, service };
}
function response(body: unknown, status = 200) { return Response.json(body, { status, headers: { "Cache-Control": "no-store" } }); }
function failure(error: unknown): Response {
  if (error instanceof CampaignExecutionError || error instanceof BlueprintError) return response({ success: false, code: error.code }, error.status);
  if (error instanceof z.ZodError) return response({ success: false, code: "INVALID_INPUT" }, 400);
  try { executionDatabaseError(error); } catch (mapped) {
    if (mapped instanceof CampaignExecutionError && mapped.code !== "PERSISTENCE_UNAVAILABLE") return failure(mapped);
  }
  return discussionApiError(error);
}
export async function executionGet(request: Request) {
  try {
    const bound = await boundary(request); const url = new URL(request.url);
    if (url.searchParams.has("campaignId")) return response(await bound.service.view(z.uuid().parse(url.searchParams.get("campaignId"))));
    if (url.searchParams.has("preorderId")) return response(await readPublishedOffer(bound.repository, { businessId: bound.owner.businessId, preorderId: z.uuid().parse(url.searchParams.get("preorderId")) }, bound.now()));
    return response({ campaigns: await bound.repository.list(), synthetic: true });
  } catch (error) { return failure(error); }
}
const ActionSchema = z.discriminatedUnion("action", [PublishCampaignCommandSchema.extend({ action: z.literal("publish") }),
  CloseCampaignCommandSchema.extend({ action: z.literal("close") }), TaskCommandSchema.extend({ action: z.literal("task") })]);
export async function executionPost(request: Request) {
  try {
    const bound = await boundary(request); checkWriteOrigin(request);
    const { action, ...body } = ActionSchema.parse(await readDiscussionBody(request));
    return response(action === "publish" ? await bound.service.publish(body) : action === "close" ? await bound.service.close(body) : await bound.service.task(body));
  } catch (error) { return failure(error); }
}
