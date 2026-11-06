import { z } from "zod";
import type { StrategyProvider, GeminiReply } from "./contracts";
import type { DevelopmentScenario } from "./persistence-contracts";

export function developmentEnabled(environment: { NODE_ENV?: string; CAMPAIGN_DISCUSSION_PROVIDER?: string; CAMPAIGN_DISCUSSION_CONTEXT?: string }) {
  return ["development", "test"].includes(environment.NODE_ENV ?? "") &&
    ["fake", "gemini"].includes(environment.CAMPAIGN_DISCUSSION_PROVIDER ?? "") && environment.CAMPAIGN_DISCUSSION_CONTEXT === "seeded";
}
const PromptSchema = z.object({ contextBinding: z.object({ contextHash: z.string() }),
  authoritativeFacts: z.object({ preorder: z.object({ startsAt: z.string(), endsAt: z.string(), orderableUnits: z.number().int().nonnegative() }) }),
  ownerPreferences: z.object({ budgetCapIdr: z.number().nullable(), allowDiscount: z.boolean(), channels: z.array(z.enum(["whatsapp", "instagram"])).min(1) }),
  untrustedText: z.object({ userMessage: z.string(), history: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() })) }),
  historicalKnowledge:z.object({status:z.string(),memories:z.array(z.object({memoryId:z.string(),lessons:z.array(z.string()).default([])}))}).optional(),
});
export function developmentProvider(scenario: DevelopmentScenario, environment: Parameters<typeof developmentEnabled>[0]): StrategyProvider {
  if (!developmentEnabled(environment) || environment.CAMPAIGN_DISCUSSION_PROVIDER !== "fake") throw new Error("Fake provider requires explicit development/test configuration");
  return { async generate(prompt) {
    if (scenario === "failure") return { success: false, code: "PROVIDER_TIMEOUT" };
    if (scenario === "invalid") return { success: true, text: "{invalid synthetic output", model: "development-fake", requestId: null };
    const data = PromptSchema.parse(JSON.parse(prompt.input));
    const text = [...data.untrustedText.history.filter((message) => message.role === "user").map((message) => message.content), data.untrustedText.userMessage].join(" ");
    const last = (pattern: RegExp) => { const matches = [...text.matchAll(pattern)]; const value = matches.at(-1)?.[1]; return value ? Number(value) : null; };
    const requestedDiscount = scenario === "revision" ? last(/diskon\s+(\d+(?:\.\d+)?)\s*%/gi) : null;
    const latestOffer = [...text.matchAll(/\b(pengingat|harga normal|diskon(?:\s+\d+(?:\.\d+)?\s*%)?)/gi)].at(-1)?.[1] ?? "diskon";
    const revisionNormal = scenario === "revision" && !latestOffer.toLowerCase().startsWith("diskon");
    const bps = data.ownerPreferences.allowDiscount && scenario !== "normal" && !revisionNormal ? Math.round((requestedDiscount ?? 10) * 100) : 0;
    const units = Math.max(1, Math.min(last(/unit\s+(\d+)/gi) ?? (bps ? 6 : 4), data.authoritativeFacts.preorder.orderableUnits));
    const cost = Math.min(last(/(?:budget|biaya)\s+(\d+)/gi) ?? (bps ? 25000 : 10000), data.ownerPreferences.budgetCapIdr ?? 1_000_000);
    const memoryId=data.historicalKnowledge?.status==="available"?data.historicalKnowledge.memories[0]?.memoryId:undefined;
    const historicalReferences=memoryId?[`memory:${memoryId}`]:[];
    const spendingLesson=Boolean(memoryId&&data.historicalKnowledge?.memories.some((m)=>m.lessons.some((text)=>/budget|belanja|pengeluaran|biaya/i.test(text))));
    const historicalRationale=spendingLesson?"Pengalaman terdahulu menjadi bahan pertimbangan untuk meninjau belanja promosi; fakta preorder terbaru tetap berlaku.":"Pengalaman terdahulu memberi pertimbangan pelaksanaan; fakta preorder terbaru tetap berlaku.";
    const reply: GeminiReply = { schemaVersion: 1, contextHash: data.contextBinding.contextHash,
      reply: memoryId?historicalRationale:"Alternatif sintetis siap ditinjau. Volume dan belanja promosi tetap asumsi pemilik.",
      sourceReferences: ["c1.preorder", "c1.product",...historicalReferences], limitations: ["Fake Gemini dan konteks seed development; KPI aktual belum tersedia."],
      options: [{ proposalKey: bps ? "synthetic-discount" : "synthetic-reminder", title: bps ? "Penawaran diskon sintetis" : "Pengingat preorder sintetis",
        marketingApproach: bps ? "limited_discount" : "scheduled_reminder",
        offer: bps ? { offerType: "percent_discount", discountBps: bps } : { offerType: "normal_price", discountBps: 0 },
        assumedAdditionalUnits: units, assumedPromotionCostIdr: cost, channels: data.ownerPreferences.channels,
        startsAt: data.authoritativeFacts.preorder.startsAt, endsAt: data.authoritativeFacts.preorder.endsAt,
        hypothesis: memoryId?historicalRationale:"Pengingat atau penawaran mungkin membantu calon pembeli meninjau preorder.",
        assumptions: ["Asumsi dapat direvisi pemilik; tidak ada prediksi permintaan."], risks: ["Respons calon pembeli belum diketahui."], sourceReferences: ["c1.preorder",...historicalReferences] }],
    };
    return { success: true, text: JSON.stringify(reply), model: "development-fake", requestId: null };
  } };
}
