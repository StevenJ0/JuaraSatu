import { describe, expect, it, vi } from "vitest";
import { blueprintFixture, blueprintEnvironment } from "../fixtures/blueprint";
import { freshContextInput } from "../fixtures/ai-context";
import { generateBlueprint, RevisionCommandSchema } from "../../src/features/campaign-blueprint/blueprint-service";
import { validateBlueprint, validateSelectedProposal, fingerprint } from "../../src/features/campaign-blueprint/blueprint-domain";
import { BlueprintPlanSchema, CampaignBlueprintSchema } from "../../src/features/campaign-blueprint/contracts";
import { developmentBlueprintProvider } from "../../src/features/campaign-blueprint/development-provider";

describe("campaign blueprint domain", () => {
  it("creates a complete selected-source plan with deterministic financials and no approval/publication", async () => {
    const f = await blueprintFixture(); const body = await generateBlueprint(f.input, f.dependencies);
    expect(CampaignBlueprintSchema.safeParse(body).success).toBe(true);
    expect(body).toMatchObject({ campaignId: f.input.campaign.id, source: f.input.selected.source, blueprintVersion: 1,
      offer: { type: "normal_price", discountBps: 0 }, financial: { frozenBasePriceIdr: 120000, calculation: { hypotheticalFinalUnitPriceIdr: 120000, scenarioContributionIdr: 170000 } },
      kpiPlan: { actualMetrics: null }, synthetic: true });
    expect(body.tasks).toHaveLength(2); expect(body.contents).toHaveLength(1);
    expect(body).not.toHaveProperty("approved_at"); expect(body).not.toHaveProperty("published_at");
  });
  it("requires explicit Gemini provenance metadata, permits null provider ID, and keeps Fake metadata absent", async () => {
    const f = await blueprintFixture(), base = await generateBlueprint(f.input, f.dependencies);
    const real = { ...base, provider: "gemini", model: "gemini-3.6-flash", providerRequestId: null };
    expect(CampaignBlueprintSchema.parse(real).providerRequestId).toBeNull();
    expect(CampaignBlueprintSchema.safeParse({ ...real, providerRequestId: undefined }).success).toBe(false);
    expect(CampaignBlueprintSchema.safeParse({ ...real, model: undefined }).success).toBe(false);
    expect(CampaignBlueprintSchema.safeParse({ ...base, providerRequestId: null }).success).toBe(false);
    expect(CampaignBlueprintSchema.safeParse(base).success).toBe(true);
  });

  it("uses frozen price for discount and never stacks onto the effective discounted offer", async () => {
    const f = await blueprintFixture(); f.input.command.edits.discountBps = 500; f.input.command.edits.marketingApproach = "limited_discount";
    const body = await generateBlueprint(f.input, f.dependencies);
    expect(body.financial.calculation.hypotheticalFinalUnitPriceIdr).toBe(114000);
    expect(body.offer).toEqual({ type: "percent_discount", discountBps: 500 });
  });
  it.each(["identity", "alternative", "preorder", "unsaved"] as const)("rejects invalid selected proposal %s", async (kind) => {
    const f = await blueprintFixture(); const selected = structuredClone(f.input.selected);
    if (kind === "identity") selected.source.proposalVersion++;
    if (kind === "alternative") selected.alternative.offer = { offerType: "percent_discount", discountBps: 500 };
    if (kind === "preorder") { selected.proposal.preorderId = "99999999-9999-4999-8999-999999999999"; selected.source.proposalHash = fingerprint(selected.proposal); }
    if (kind === "unsaved") { selected.proposal.persistence = "not_saved"; selected.source.proposalHash = fingerprint(selected.proposal); }
    expect(() => validateSelectedProposal(selected, f.contextInput, f.dependencies.now())).toThrow();
  });
  it("rejects stale context and performs post-provider revalidation", async () => {
    const f = await blueprintFixture(); let reads = 0;
    f.dependencies.loadContext = async () => { const input = structuredClone(f.contextInput); if (++reads > 1 && input.c1.status === "available") input.c1.data.snapshot.productVersion++; return input; };
    await expect(generateBlueprint(f.input, f.dependencies)).rejects.toMatchObject({ code: "STALE_CONTEXT" });
  });
  it.each(["capacity", "date", "offer", "policy"] as const)("rejects invalid %s assumptions", async (kind) => {
    const f = await blueprintFixture();
    if (kind === "capacity") f.input.command.edits.targetAdditionalUnits = 9;
    if (kind === "date") f.input.command.edits.endsAt = "2026-12-01T00:00:00Z";
    if (kind === "offer") { f.input.command.edits.discountBps = 500; f.input.command.edits.marketingApproach = "scheduled_reminder"; }
    if (kind === "policy") { f.input.command.edits.discountBps = 9000; f.input.command.edits.marketingApproach = "limited_discount"; }
    await expect(generateBlueprint(f.input, f.dependencies)).rejects.toThrow();
  });
  it("preserves unknown costs for normal price and rejects a discount with unknown costs", async () => {
    const raw = freshContextInput(); if (raw.c1.status === "available") { raw.c1.data.product.variableCostIdr = null; raw.c1.data.product.costQuality = "unknown"; }
    const f = await blueprintFixture(raw); const body = await generateBlueprint(f.input, f.dependencies);
    expect(body.financial.calculation.scenarioContributionIdr).toBeNull(); expect(body.financial.variableCostIdr).toBeNull();
    f.input.command.edits.discountBps = 500; f.input.command.edits.marketingApproach = "limited_discount";
    await expect(generateBlueprint(f.input, f.dependencies)).rejects.toMatchObject({ code: "FINANCIAL_OR_CAPACITY_BLOCKER" });
  });
  it.each(["failure", "invalid"] as const)("rejects provider %s", async (scenario) => {
    const f = await blueprintFixture(); f.dependencies.provider = developmentBlueprintProvider(scenario, blueprintEnvironment);
    await expect(generateBlueprint(f.input, f.dependencies)).rejects.toMatchObject({ code: scenario === "failure" ? "PROVIDER_UNAVAILABLE" : "INVALID_BLUEPRINT" });
  });
  it.each(["duplicate-task", "duplicate-content", "task-limit", "content-limit", "caption-limit"] as const)("enforces %s", async (kind) => {
    const f = await blueprintFixture(); const body = await generateBlueprint(f.input, f.dependencies);
    if (kind === "duplicate-task") body.tasks.push(body.tasks[0]);
    if (kind === "duplicate-content") body.contents.push(body.contents[0]);
    if (kind === "task-limit") body.tasks = Array.from({ length: 13 }, (_, n) => ({ ...body.tasks[0], key: `task-${n}` }));
    if (kind === "content-limit") body.contents = Array.from({ length: 9 }, (_, n) => ({ ...body.contents[0], key: `content-${n}` }));
    if (kind === "caption-limit") body.contents[0].body = "x".repeat(2201);
    expect(BlueprintPlanSchema.strip().safeParse(body).success).toBe(false);
  });
  it("enforces schedule/channel/content guards and recomputes financial fields", async () => {
    const f = await blueprintFixture(); const body = await generateBlueprint(f.input, f.dependencies);
    const tampered = structuredClone(body); tampered.financial.calculation.scenarioRevenueIdr = 1;
    expect(validateBlueprint(tampered, f.contextInput, f.dependencies.now()).financial.calculation.scenarioRevenueIdr).toBe(480000);
    const date = structuredClone(body); date.tasks[0].dueAt = body.executionWindow.endsAt;
    expect(() => validateBlueprint(date, f.contextInput, f.dependencies.now())).toThrow();
    const channel = structuredClone(body); channel.tasks[0].channel = "instagram";
    expect(() => validateBlueprint(channel, f.contextInput, f.dependencies.now())).toThrow();
    const caption = structuredClone(body); caption.contents[0].body = "Diskon 99% dijamin laris";
    expect(() => validateBlueprint(caption, f.contextInput, f.dependencies.now())).toThrow();
  });
  it("checks campaign/blueprint CAS before invoking the provider", async () => {
    const f = await blueprintFixture(); const provider = vi.spyOn(f.dependencies.provider, "generate"); f.input.campaign.version = 2;
    await expect(generateBlueprint(f.input, f.dependencies)).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    expect(provider).not.toHaveBeenCalled();
    expect(RevisionCommandSchema.safeParse({ ...f.input.command, expectedBlueprintVersion: 1 }).success).toBe(false);
  });
  it("requires explicit development flags and rejects fake provider in production", () => {
    expect(() => developmentBlueprintProvider("valid", { ...blueprintEnvironment, NODE_ENV: "production" })).toThrow();
    expect(() => developmentBlueprintProvider("valid", { ...blueprintEnvironment, CAMPAIGN_BLUEPRINT_PROVIDER: undefined })).toThrow();
  });
});
