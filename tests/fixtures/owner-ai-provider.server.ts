// Test-bundle replacement only. Production owner routes never import this module.
import { appendFileSync } from "node:fs";
import { z } from "zod";
import type { StrategyProvider } from "../../src/features/campaign-strategist/contracts";
import type { BlueprintProvider } from "../../src/features/campaign-blueprint/contracts";

const Facts = z.object({ contextBinding: z.object({ contextHash: z.string(), sourceVersions: z.unknown() }),
  authoritativeFacts: z.object({ preorder: z.object({ businessId: z.string(), preorderId: z.string(), baseUnitPriceIdr: z.number(),
    quotaUnits: z.number(), allocatedUnits: z.number(), heldUnits: z.number(), paidUnits: z.number(), endsAt: z.string() }),
    product: z.object({ variableCostIdr: z.number().nullable() }), capacity: z.object({ totalUnits: z.number() }) }) });
function audit(value: unknown) {
  if (process.env.P13_TEST_AUDIT_PATH) appendFileSync(process.env.P13_TEST_AUDIT_PATH, `${JSON.stringify(value)}\n`);
}
export function ownerProviderIdentity() { return { provider: "test-mock", model: "p13-test-mock" }; }
export function ownerStrategyProvider(): StrategyProvider {
  return { async generate(prompt) {
    const facts = Facts.parse(JSON.parse(prompt.input));
    audit({ kind: "strategy", ...facts });
    return { success: true, model: "p13-test-mock", requestId: null, text: JSON.stringify({ schemaVersion: 1,
      contextHash: facts.contextBinding.contextHash, reply: "Berikut rancangan untuk ditinjau pemilik.",
      sourceReferences: ["c1.preorder", "c1.product"], limitations: ["Respons mock untuk pengujian integrasi, bukan prediksi."],
      options: [{ proposalKey: "owner-reminder", title: "Pengingat preorder", marketingApproach: "scheduled_reminder",
        offer: { offerType: "normal_price", discountBps: 0 }, assumedAdditionalUnits: 2, assumedPromotionCostIdr: 1000,
        channels: ["whatsapp"], startsAt: new Date().toISOString(), endsAt: facts.authoritativeFacts.preorder.endsAt,
        hypothesis: "Pengingat mungkin membantu pembeli meninjau detail preorder.", assumptions: ["Volume merupakan asumsi pemilik."],
        risks: ["Respons pembeli belum diketahui."], sourceReferences: ["c1.preorder"] }] }) };
  } };
}
export function ownerBlueprintProvider(): BlueprintProvider {
  return { async generate({ edits, alternative, now }) {
    audit({ kind: "blueprint", target: edits.targetAdditionalUnits, budget: edits.budgetCapIdr,
      providerTarget: alternative.assumedAdditionalUnits, providerBudget: alternative.assumedPromotionCostIdr });
    return { goal: "Meninjau pelaksanaan pengingat preorder.", hypothesis: "Pesan yang jelas mungkin membantu peninjauan penawaran.",
      audienceHypothesis: "Calon pembeli yang berminat pada produk.", rationale: "Gunakan fakta preorder dan tinjauan pemilik.",
      tasks: [{ key: "review-message", title: "Tinjau pesan pengingat", description: "Periksa rincian preorder sebelum membagikan pesan.",
        channel: "whatsapp", dueAt: new Date(Math.max(Date.parse(now), Date.parse(edits.startsAt)) + 30000).toISOString() }],
      contents: [{ key: "reminder-caption", channel: "whatsapp", type: "caption", body: "Preorder tersedia untuk ditinjau. Periksa detail dan jadwal pengambilan." }],
      risks: ["Minat pembeli belum dapat dipastikan."], dependencies: ["Rincian preorder harus tetap valid."],
      ownerChecklist: ["Tinjau pesan dan jadwal sebelum pelaksanaan."] };
  } };
}
