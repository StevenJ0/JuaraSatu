import { buildBusinessContext, type BuildBusinessContextInput } from "../../src/features/ai-context";
import { generateCampaignStrategies, StrategyProposalSchema } from "../../src/features/campaign-strategist";
import { developmentProvider } from "../../src/features/campaign-strategist/development-provider";
import { developmentBlueprintProvider } from "../../src/features/campaign-blueprint/development-provider";
import { fingerprint, initialBlueprintEdits } from "../../src/features/campaign-blueprint/blueprint-domain";
import type { CampaignRow, PersistedSelection } from "../../src/features/campaign-blueprint/contracts";
import type { RevisionCommand } from "../../src/features/campaign-blueprint/blueprint-service";
import { freshContextInput, contextFixture } from "./ai-context";
export const blueprintEnvironment = { NODE_ENV: "test", CAMPAIGN_DISCUSSION_PROVIDER: "fake", CAMPAIGN_DISCUSSION_CONTEXT: "seeded",
  CAMPAIGN_BLUEPRINT_PROVIDER: "fake", CAMPAIGN_BLUEPRINT_APPROVAL: "synthetic" };
export async function blueprintFixture(contextInput: BuildBusinessContextInput = freshContextInput()) {
  const built = buildBusinessContext(contextInput); if (!built.success) throw new Error("Invalid context fixture");
  const result = await generateCampaignStrategies({ ...contextInput.scope, sessionId: "33333333-3333-4333-8333-333333333333",
    requestKey: "blueprint-fixture", expectedVersion: 1, expectedContextHash: built.data.contextHash, message: "Buat pengingat", history: [],
    preferences: { budgetCapIdr: 50000, allowDiscount: true, channels: ["whatsapp"] } },
  { provider: developmentProvider("normal", blueprintEnvironment), loadContext: async () => structuredClone(contextInput), now: () => contextFixture.calculatedAt });
  if (!result.success || !result.data.options[0]) throw new Error("No strategy fixture");
  const proposal = StrategyProposalSchema.parse({ ...result.data, persistence: "saved" });
  const selected: PersistedSelection = { proposal, alternative: proposal.options[0], source: { sessionId: proposal.sessionId ?? "",
    generationId: "44444444-4444-4444-8444-444444444444", messageId: "55555555-5555-4555-8555-555555555555",
    proposalVersion: proposal.proposalVersion, proposalKey: proposal.options[0].proposalKey, proposalHash: fingerprint(proposal) } };
  const edits = initialBlueprintEdits(selected);
  const campaign: CampaignRow = { id: "66666666-6666-4666-8666-666666666666", business_id: proposal.businessId, preorder_id: proposal.preorderId,
    name: edits.title, status: "draft", version: 1, active_blueprint_id: null, published_at: null, offer_type: "normal_price", discount_bps: 0,
    budget_cap_idr: edits.budgetCapIdr, target_additional_units: edits.targetAdditionalUnits, starts_at: edits.startsAt, ends_at: edits.endsAt };
  const command: RevisionCommand = { campaignId: campaign.id, requestId: "77777777-7777-4777-8777-777777777777", expectedCampaignVersion: 1,
    expectedBlueprintId: null, expectedBlueprintVersion: null, edits, scenario: "valid" };
  return { input: { campaign, command, selected, nextVersion: 1, activeVersion: null }, contextInput,
    dependencies: { provider: developmentBlueprintProvider("valid", blueprintEnvironment), loadContext: async () => structuredClone(contextInput), now: () => contextFixture.calculatedAt } };
}
