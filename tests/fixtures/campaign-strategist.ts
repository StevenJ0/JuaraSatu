import type { DiscussionInput, GeminiReply, StrategyProvider, StrategyProviderResult } from "../../src/features/campaign-strategist/contracts";
import { buildBusinessContext } from "../../src/features/ai-context";
import { contextFixture, freshContextInput } from "./ai-context";

const context = buildBusinessContext(contextFixture);
if (!context.success) throw new Error("Invalid synthetic strategist fixture");
export const discussionFixture = {
  ...contextFixture.scope, sessionId: null, requestKey: "synthetic-request-1", expectedVersion: 1,
  expectedContextHash: context.data.contextHash,
  message: "Bandingkan pengingat dengan penawaran diskon. Semua volume adalah asumsi saya.", history: [],
  preferences: { budgetCapIdr: 50_000, allowDiscount: true, channels: ["whatsapp", "instagram"] },
} satisfies DiscussionInput;
export const replyFixture = {
  schemaVersion: 1, contextHash: context.data.contextHash,
  reply: "Target belum tercapai dan slot tersedia lebih kecil daripada selisih target. Berikut alternatif hipotetis untuk ditinjau.",
  sourceReferences: ["c1.preorder", "c8.effective_offer"],
  options: [
    { proposalKey: "reminder-normal", title: "Pengingat preorder", marketingApproach: "scheduled_reminder",
      offer: { offerType: "normal_price", discountBps: 0 }, assumedAdditionalUnits: 4, assumedPromotionCostIdr: 10_000,
      channels: ["whatsapp"], startsAt: "2026-11-02T03:00:00Z", endsAt: "2026-11-05T11:00:00Z",
      hypothesis: "Pengingat dapat membantu calon pembeli meninjau preorder.",
      assumptions: ["Volume merupakan asumsi pemilik."], risks: ["Respons pembeli belum diketahui."], sourceReferences: ["c1.preorder"],
      lever: "urgency", targetAudience: "Pembeli lama dan kontak pemilik",
      tactics: [{ platform: "past_buyers", action: "Kirim pengingat pribadi dua hari sebelum preorder ditutup." }], hashtags: [] },
    { proposalKey: "discount-five", title: "Diskon terbatas", marketingApproach: "limited_discount",
      offer: { offerType: "percent_discount", discountBps: 500 }, assumedAdditionalUnits: 6, assumedPromotionCostIdr: 25_000,
      channels: ["instagram"], startsAt: "2026-11-02T03:00:00Z", endsAt: "2026-11-05T11:00:00Z",
      hypothesis: "Penawaran terbatas mungkin relevan bagi calon pembeli.",
      assumptions: ["Volume bukan prediksi permintaan."], risks: ["Kontribusi per unit turun."], sourceReferences: ["c1.product", "c1.preorder"],
      lever: "price", targetAudience: "Mahasiswa di sekitar kampus",
      tactics: [{ platform: "instagram", action: "Unggah foto produk dengan tenggat preorder di caption." },
        { platform: "tiktok", action: "Platform baru bagi pemilik: video singkat proses produksi." }], hashtags: ["#Tembalang", "#KaosLokal"] },
  ], limitations: ["Hasil bergantung pada asumsi dan perlu review pemilik."],
} satisfies GeminiReply;

export function fakeProvider(result: StrategyProviderResult = {
  success: true, text: JSON.stringify(replyFixture), model: "fake-gemini", requestId: "fake-provider-request",
}): StrategyProvider {
  return { generate: async () => structuredClone(result) };
}
export function strategistDependencies(provider: StrategyProvider = fakeProvider()) {
  return { provider, loadContext: async () => freshContextInput(), now: () => contextFixture.calculatedAt };
}
