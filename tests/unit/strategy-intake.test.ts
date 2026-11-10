import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
vi.mock("server-only", () => ({}));
import { buildBusinessContext } from "../../src/features/ai-context";
import { generateCampaignStrategies } from "../../src/features/campaign-strategist";
import { buildStrategyPrompt } from "../../src/features/campaign-strategist/prompt";
import { diagnoseTarget } from "../../src/features/campaign-strategist/target-diagnosis";
import { narrativeRejection } from "../../src/lib/ai/narrative-safety";
import { anotherProposalMessage, budgetDigits, intakeMessage } from "../../src/features/campaign-strategist/components/intake";
import { formatIdrInput } from "../../src/lib/format-idr";
import { DiscussionInputSchema, GeminiReplySchema, summarizeProposals, type DiscussionInput, type GeminiReply, type OwnerIntake, type PreviousProposal, type StrategyProposal } from "../../src/features/campaign-strategist/contracts";
import { sendPersistentDiscussion } from "../../src/features/campaign-strategist/persistent-discussion-service";
import { fakeDiscussionRepository } from "../fixtures/fake-discussion-repository";
import { validateBlueprint } from "../../src/features/campaign-blueprint/blueprint-domain";
import { generateBlueprint } from "../../src/features/campaign-blueprint/blueprint-service";
import { discussionFixture, replyFixture, strategistDependencies, fakeProvider } from "../fixtures/campaign-strategist";
import { contextFixture } from "../fixtures/ai-context";
import { blueprintFixture } from "../fixtures/blueprint";

const intake: OwnerIntake = { assets: ["instagram", "community"], assetNotes: "Grup alumni, hubungi saya di owner@example.com",
  targetBuyer: "Mahasiswa di sekitar kampus", productStrength: "Bahan katun tebal", suspectedCause: "unaware", dailyTime: "30_60m" };
const withIntake = { ...discussionFixture, preferences: { ...discussionFixture.preferences, intake } } satisfies DiscussionInput;
function withReply(reply: GeminiReply) {
  return strategistDependencies(fakeProvider({ success: true, text: JSON.stringify(reply), model: "fake-gemini", requestId: null }));
}

describe("promotion budget field", () => {
  it("keeps digits only, drops leading zeros and caps at the server limit", () => {
    expect(budgetDigits("0777")).toBe("777");
    expect(budgetDigits("Rp50.000")).toBe("50000");
    expect(budgetDigits("0")).toBe("0");
    expect(budgetDigits("")).toBe("");
    expect(budgetDigits("99999999999")).toBe("1000000000");
    expect(formatIdrInput(budgetDigits("50000"))).toBe("Rp50.000");
  });
});

describe("target diagnosis", () => {
  const base = { targetUnits: 30, startsAt: "2026-11-01T00:00:00Z", endsAt: "2026-11-10T00:00:00Z", now: "2026-11-05T00:00:00Z" };
  it("computes the gap, days left and the daily pace needed", () => {
    expect(diagnoseTarget({ ...base, paidUnits: 12 })).toEqual({ targetUnits: 30, paidUnits: 12, gapUnits: 18, daysLeft: 5, daysElapsed: 4,
      unitsPerDayNeeded: 4, paidPerDaySoFar: 3, pace: "behind" });
  });
  it("separates far behind, on track and a met target", () => {
    expect(diagnoseTarget({ ...base, paidUnits: 2 }).pace).toBe("far_behind");
    expect(diagnoseTarget({ ...base, paidUnits: 20 }).pace).toBe("on_track");
    expect(diagnoseTarget({ ...base, paidUnits: 30 })).toMatchObject({ gapUnits: 0, unitsPerDayNeeded: 0, pace: "target_met" });
  });
});

describe("strategist intake and tactics", () => {
  it("sends structured answers as preferences and free text only as redacted untrusted data", () => {
    const context = buildBusinessContext(contextFixture);
    if (!context.success) throw new Error("Expected context fixture");
    const prompt = buildStrategyPrompt(context.data, withIntake);
    const input: unknown = JSON.parse(prompt.input);
    expect(input).toMatchObject({
      ownerPreferences: { intake: { assets: ["instagram", "community"], suspectedCause: "unaware", dailyTime: "30_60m" } },
      untrustedText: { ownerIntake: { targetBuyer: "Mahasiswa di sekitar kampus", assetNotes: expect.stringContaining("[contact removed]") } },
      targetDiagnosis: { gapUnits: context.data.preorder.paidTargetGapUnits },
    });
    expect(JSON.stringify((input as { ownerPreferences: unknown }).ownerPreferences)).not.toContain("Mahasiswa");
    expect(prompt.systemInstruction).toContain("Do not default to WhatsApp");
  });

  it("sends the owner's own explanation of the cause as redacted untrusted text, and still accepts answers saved without it", () => {
    const context = buildBusinessContext(contextFixture);
    if (!context.success) throw new Error("Expected context fixture");
    const explained = { ...withIntake, preferences: { ...withIntake.preferences, intake: { ...intake, causeNotes: "Banyak yang tanya via 0812-3456-7890 tapi tidak jadi pesan" } } };
    expect(JSON.parse(buildStrategyPrompt(context.data, explained).input)).toMatchObject({
      untrustedText: { ownerIntake: { causeNotes: expect.stringContaining("[contact removed]") } } });
    expect(intakeMessage(explained.preferences.intake, 50_000, true, "")).toContain("Penjelasan saya: Banyak yang tanya");
    expect(DiscussionInputSchema.safeParse(withIntake).success).toBe(true);
  });

  it("flattens markdown the model writes into readable plain text", async () => {
    const reply = structuredClone(replyFixture);
    reply.reply = "**Rekomendasi:** pakai konten nilai.\n- Story Instagram\n- Pesan WhatsApp";
    reply.options[1].hypothesis = "**Konten nilai** mungkin membantu calon pembeli meninjau preorder.";
    reply.options[1].tactics = [{ platform: "instagram", action: "Unggah *story* foto produk sebelum preorder ditutup." }];
    const result = await generateCampaignStrategies(withIntake, withReply(reply));
    if (!result.success) throw new Error(result.error.code);
    expect(result.data.reply).toBe("Rekomendasi: pakai konten nilai.\n• Story Instagram\n• Pesan WhatsApp");
    expect(result.data.options[1]).toMatchObject({ hypothesis: "Konten nilai mungkin membantu calon pembeli meninjau preorder.",
      tactics: [{ action: "Unggah story foto produk sebelum preorder ditutup." }] });
  });

  it("accepts urgency copy with real remaining slots and a deadline time, but not invented counts or sales", () => {
    expect(narrativeRejection("Sisa 8 slot, tutup 6 Nov 11.00.", { capacityUnits: [8] })).toBeNull();
    expect(narrativeRejection("Preorder ditutup 6 Nov, pukul 20.00.", {})).toBeNull();
    expect(narrativeRejection("Sisa 8 slot, tutup 6 Nov 11.00.", { capacityUnits: [5] })).toBe("numeric_claim");
    expect(narrativeRejection("Sudah terjual 8 unit minggu ini.", { capacityUnits: [8] })).toBe("numeric_claim");
  });

  it("puts the owner's wish into the request for another proposal", () => {
    expect(anotherProposalMessage("  fokus ke TikTok tanpa diskon ")).toBe("Usulan sebelumnya kurang cocok. Beri satu usulan lain.\nYang saya inginkan: fokus ke TikTok tanpa diskon");
    expect(anotherProposalMessage("")).toContain("pendekatan atau platform yang berbeda");
  });

  it("keeps validated audience, tactics and hashtags on the proposal", async () => {
    const result = await generateCampaignStrategies(withIntake, withReply(replyFixture));
    if (!result.success) throw new Error(result.error.code);
    expect(result.data.preferences.intake).toEqual(intake);
    expect(result.data.options[1]).toMatchObject({ lever: "price", targetAudience: "Mahasiswa di sekitar kampus",
      tactics: [{ platform: "instagram" }, { platform: "tiktok" }], hashtags: ["#Tembalang", "#KaosLokal"] });
  });

  it("drops handles and promise hashtags but keeps the safe parts of the alternative", async () => {
    const reply = structuredClone(replyFixture);
    Object.assign(reply.options[1], { targetAudience: "Pengikut @akunlokal", hashtags: ["#Tembalang", "#PastiLaku"],
      tactics: [{ platform: "x", action: "Minta @akunlokal ikut membagikan." }, { platform: "instagram", action: "Unggah foto produk sebelum preorder ditutup." }] });
    const result = await generateCampaignStrategies(withIntake, withReply(reply));
    if (!result.success) throw new Error(result.error.code);
    const option = result.data.options[1];
    expect(option).not.toHaveProperty("targetAudience");
    expect(option.tactics).toEqual([{ platform: "instagram", action: "Unggah foto produk sebelum preorder ditutup." }]);
    expect(option.hashtags).toEqual(["#Tembalang"]);
  });

  it("fills a missing option sourceReferences from the validated answer-level sources", async () => {
    const reply = structuredClone(replyFixture);
    const missing: Record<string, unknown> = { ...reply.options[0] };
    delete missing.sourceReferences;
    const result = await generateCampaignStrategies(withIntake, strategistDependencies(fakeProvider({ success: true,
      text: JSON.stringify({ ...reply, options: [missing] }), model: "fake-gemini", requestId: null })));
    if (!result.success) throw new Error(result.error.code);
    expect(result.data.options[0].sourceReferences).toEqual(reply.sourceReferences);
  });

  it("replaces a hypothesis lost only to quoted numbers when safe tactics remain, and still rejects one without tactics", async () => {
    const numeric = structuredClone(replyFixture);
    numeric.options[0].hypothesis = "Pengingat personal bisa mengonversi 37 unit tambahan.";
    const kept = await generateCampaignStrategies(withIntake, withReply(numeric));
    if (!kept.success) throw new Error(kept.error.code);
    expect(kept.data.options[0]).toMatchObject({ proposalKey: "reminder-normal", hypothesis: expect.stringContaining("belum pasti") });
    expect(kept.data.options[0].hypothesis).not.toContain("37");
    const bare: Record<string, unknown> = { ...numeric.options[0] };
    delete bare.tactics;
    const dropped = await generateCampaignStrategies(withIntake, strategistDependencies(fakeProvider({ success: true,
      text: JSON.stringify({ ...numeric, options: [bare, numeric.options[1]] }), model: "fake-gemini", requestId: null })));
    expect(dropped).toMatchObject({ success: true, data: { rejectedOptions: [{ index: 0, code: "UNSAFE_TEXT" }] } });
  });

  it("tells the model the hard limits the server enforces", () => {
    const context = buildBusinessContext(contextFixture);
    if (!context.success) throw new Error("Expected context fixture");
    expect(JSON.parse(buildStrategyPrompt(context.data, withIntake).input)).toMatchObject({ hardLimits: {
      maxAssumedAdditionalUnits: Math.min(context.data.preorder.orderableUnits, context.data.capacity?.availableUnits ?? Infinity),
      maxAssumedPromotionCostIdr: 50_000, discountAllowed: true, optionsPerAnswer: 1 } });
  });

  it("corrects the approach of a percent discount but still rejects a normal price labelled as a discount", async () => {
    const reply = structuredClone(replyFixture);
    const relabelled = { ...reply.options[1], marketingApproach: "value_content" };
    const fixed = await generateCampaignStrategies(withIntake, strategistDependencies(fakeProvider({ success: true,
      text: JSON.stringify({ ...reply, options: [relabelled] }), model: "fake-gemini", requestId: null })));
    if (!fixed.success) throw new Error(fixed.error.code);
    expect(fixed.data.options[0]).toMatchObject({ proposalKey: "discount-five", marketingApproach: "limited_discount" });
    const ambiguous = { ...reply.options[0], marketingApproach: "limited_discount" };
    expect(await generateCampaignStrategies(withIntake, strategistDependencies(fakeProvider({ success: true,
      text: JSON.stringify({ ...reply, options: [ambiguous] }), model: "fake-gemini", requestId: null }))))
      .toMatchObject({ success: true, data: { options: [], rejectedOptions: [{ index: 0, code: "PREFERENCE_CONFLICT" }] } });
  });

  it("rejects a price lever without a discount offer", async () => {
    const reply = structuredClone(replyFixture);
    reply.options[0].lever = "price";
    expect(await generateCampaignStrategies(withIntake, withReply(reply))).toMatchObject({ success: true,
      data: { options: [expect.objectContaining({ proposalKey: "discount-five" })], rejectedOptions: [{ index: 0, code: "INVALID_OPTION" }] } });
  });

  it("still accepts alternatives stored before tactics existed", async () => {
    const reply = structuredClone(replyFixture);
    const legacy: Record<string, unknown> = { ...reply.options[0] };
    for (const key of ["lever", "targetAudience", "tactics", "hashtags"]) delete legacy[key];
    const result = await generateCampaignStrategies(discussionFixture,
      strategistDependencies(fakeProvider({ success: true, text: JSON.stringify({ ...reply, options: [legacy, reply.options[1]] }), model: "fake-gemini", requestId: null })));
    if (!result.success) throw new Error(result.error.code);
    expect(result.data.options[0]).not.toHaveProperty("tactics");
    expect(result.data.options).toHaveLength(2);
  });
});

describe("one proposal per answer", () => {
  const previous: PreviousProposal = { title: "Diskon, tanya owner@example.com", lever: "price", marketingApproach: "limited_discount", discountBps: 1000, platforms: ["instagram"] };

  it("asks Gemini for at most one alternative per answer", () => {
    const schema = z.object({ properties: z.object({ options: z.object({ maxItems: z.number() }) }) }).parse(z.toJSONSchema(GeminiReplySchema, { target: "draft-07" }));
    expect(schema.properties.options.maxItems).toBe(1);
  });

  it("summarizes earlier alternatives with tactic platforms, falling back to caption channels", async () => {
    const result = await generateCampaignStrategies(withIntake, withReply(replyFixture));
    if (!result.success) throw new Error(result.error.code);
    const legacy: StrategyProposal = { ...result.data, options: [{ ...result.data.options[0], tactics: undefined }] };
    expect(summarizeProposals([legacy, result.data])).toEqual([
      { title: "Pengingat preorder", lever: "urgency", marketingApproach: "scheduled_reminder", discountBps: 0, platforms: ["whatsapp"] },
      { title: "Pengingat preorder", lever: "urgency", marketingApproach: "scheduled_reminder", discountBps: 0, platforms: ["past_buyers"] },
      { title: "Diskon terbatas", lever: "price", marketingApproach: "limited_discount", discountBps: 500, platforms: ["instagram", "tiktok"] },
    ]);
  });

  it("passes earlier proposals from the stored session to the prompt as redacted untrusted text", async () => {
    const context = buildBusinessContext(contextFixture);
    if (!context.success) throw new Error("Expected context fixture");
    const scope = { ...contextFixture.scope, ownerUserId: "11111111-1111-4111-8111-111111111111", sessionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa7" };
    const repository = fakeDiscussionRepository({ ownerUserId: scope.ownerUserId, session: { id: scope.sessionId, ...contextFixture.scope, version: 1,
      contextHash: context.data.contextHash, status: "active", messages: [], previousProposals: [previous] } });
    const prompts: string[] = [];
    const dependencies = strategistDependencies({ generate: async (prompt) => { prompts.push(prompt.input);
      return { success: true, text: JSON.stringify({ ...replyFixture, contextHash: context.data.contextHash, options: [replyFixture.options[0]] }), model: "fake-gemini", requestId: null }; } });
    expect(await sendPersistentDiscussion(scope, { sessionId: scope.sessionId, requestKey: "another-proposal", expectedVersion: 1,
      expectedContextHash: context.data.contextHash, message: "Beri satu usulan lain.", preferences: withIntake.preferences, scenario: "normal" },
    repository, dependencies)).toMatchObject({ success: true, status: "completed" });
    const input = z.object({ untrustedText: z.object({ previousProposals: z.array(z.object({ title: z.string(), lever: z.string() })) }) }).parse(JSON.parse(prompts[0]));
    expect(input.untrustedText.previousProposals).toEqual([{ lever: "price", title: "Diskon, tanya [contact removed]" }]);
  });
});

describe("blueprint tasks on other platforms", () => {
  it("accepts a task without a tracked channel and still rejects a channel outside the plan", async () => {
    const f = await blueprintFixture(); const body = await generateBlueprint(f.input, f.dependencies);
    const other = structuredClone(body); other.tasks[0] = { ...other.tasks[0], channel: null, title: "TikTok: video proses produksi" };
    expect(validateBlueprint(other, f.contextInput, f.dependencies.now()).tasks[0].channel).toBeNull();
    const outside = structuredClone(body); outside.tasks[0].channel = "instagram";
    expect(() => validateBlueprint(outside, f.contextInput, f.dependencies.now())).toThrow();
  });
});
