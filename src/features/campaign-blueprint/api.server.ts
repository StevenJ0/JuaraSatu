import "server-only";
import { z } from "zod";
import { authenticateDiscussion, checkWriteOrigin, ownedSession } from "../campaign-strategist/discussion-auth.server";
import { discussionApiError, readDiscussionBody } from "../campaign-strategist/discussion-api.server";
import { seededDevelopmentContext } from "../campaign-strategist/development-context.server";
import { privilegedTransport } from "@/lib/supabase/transport.server";
import { buildBusinessContext } from "../ai-context";
import { BlueprintError } from "./contracts";
import { blueprintDevelopmentEnabled } from "./development-provider";
import { configuredBlueprintProvider } from "./gemini.server";
import { blueprintRepository, mapBlueprintDatabaseError } from "./repository.server";
import { blueprintWorkflow, CreateBlueprintCommandSchema, ApproveBlueprintCommandSchema } from "./workflow.server";
import { RevisionCommandSchema } from "./blueprint-service";
import { GenerationClaimError } from "@/lib/ai/generation-claims.server";

function errorResponse(error: unknown) {
  if (error instanceof BlueprintError || error instanceof GenerationClaimError) return Response.json({ success: false, code: error.code }, { status: error.status, headers: { "Cache-Control": "no-store",
    ...(error instanceof GenerationClaimError && error.retryAfter ? { "Retry-After": String(error.retryAfter) } : {}) } });
  if (error instanceof z.ZodError) return Response.json({ success: false, code: "INVALID_BLUEPRINT" }, { status: 400 });
  try { mapBlueprintDatabaseError(error); } catch (mapped) {
    if (mapped instanceof BlueprintError && mapped.code !== "PERSISTENCE_UNAVAILABLE") return errorResponse(mapped);
  }
  return discussionApiError(error);
}
async function boundary(request: Request) {
  const owner = await authenticateDiscussion(request);
  if (!blueprintDevelopmentEnabled(process.env)) throw new BlueprintError("CONFIGURATION_ERROR", 503);
  const now = () => new Date().toISOString();
  const repository = blueprintRepository(owner.user, privilegedTransport, owner);
  const seeded = seededDevelopmentContext(owner.user, process.env, now);
  const loadContext = async (scope: Parameters<typeof seeded>[0]) => {
    try { return await seeded(scope); } catch { throw new BlueprintError("CONTEXT_UNAVAILABLE", 503); }
  };
  const workflow = blueprintWorkflow(repository, { loadContext, now,
    provider: (scenario) => configuredBlueprintProvider(scenario, process.env),
    approvalEnabled: process.env.CAMPAIGN_BLUEPRINT_APPROVAL === "synthetic" });
  return { owner, repository, workflow, loadContext, ownerMode: false, checkOrigin: checkWriteOrigin };
}
export async function blueprintGet(request: Request) {
  return blueprintGetFor(request, boundary);
}
export function createBlueprintHandlers(bind: typeof boundary) {
  return { GET: (request: Request) => blueprintGetFor(request, bind), POST: (request: Request) => blueprintPostFor(request, bind) };
}
async function blueprintGetFor(request: Request, bind: typeof boundary) {
  try {
    const bound = await bind(request); const url = new URL(request.url);
    if (url.searchParams.has("sessionId")) {
      const sessionId = z.uuid().parse(url.searchParams.get("sessionId")); const scope = await ownedSession(bound.owner, sessionId);
      let currentHash: string | null = null;
      try { const context = buildBusinessContext(await bound.loadContext(scope)); if (context.success) currentHash = context.data.contextHash; } catch { /* History stays readable. */ }
      const proposals = (await bound.repository.list(sessionId)).map((row) => ({ ...row, eligible: row.contextHash === currentHash }));
      return Response.json({ proposals, currentHash }, { headers: { "Cache-Control": "no-store" } });
    }
    const campaignId = z.uuid().parse(url.searchParams.get("campaignId")); const view = await bound.repository.load(campaignId);
    let currentHash: string | null = null;
    try { const context = buildBusinessContext(await bound.loadContext({ businessId: view.campaign.business_id, preorderId: view.campaign.preorder_id })); if (context.success) currentHash = context.data.contextHash; } catch { /* Show persisted history without claiming freshness. */ }
    return Response.json({ ...view, currentHash }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
const ActionSchema = z.discriminatedUnion("action", [
  CreateBlueprintCommandSchema.extend({ action: z.literal("create") }),
  RevisionCommandSchema.safeExtend({ action: z.literal("revise") }),
  ApproveBlueprintCommandSchema.extend({ action: z.literal("approve") }),
]);
export async function blueprintPost(request: Request) {
  return blueprintPostFor(request, boundary);
}
async function blueprintPostFor(request: Request, bind: typeof boundary) {
  try {
    const bound = await bind(request); bound.checkOrigin(request);
    const raw = ActionSchema.parse(await readDiscussionBody(request, 65536));
    const { action, ...command } = raw;
    if (bound.ownerMode && "scenario" in command && command.scenario !== "valid") throw new BlueprintError("FAKE_SCENARIO_DISABLED", 400);
    if (bound.ownerMode && action === "create" && "selection" in command) {
      const source = await bound.repository.selection(command.selection);
      const existing = z.array(z.object({ id: z.uuid() })).parse(await bound.owner.user.select("campaigns", {
        select: "id", business_id: `eq.${bound.owner.businessId}`, preorder_id: `eq.${source.proposal.preorderId}`,
        status: "in.(draft,published)", limit: "1" }));
      if (existing[0] && existing[0].id !== command.campaignId) throw new BlueprintError("CAMPAIGN_EXISTS", 409);
    }
    const result = action === "create" ? await bound.workflow.create(command) : action === "revise" ? await bound.workflow.revise(command) : await bound.workflow.approve(command);
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
