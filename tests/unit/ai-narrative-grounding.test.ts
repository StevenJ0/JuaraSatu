import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { discussionFixture, replyFixture, fakeProvider, strategistDependencies } from "../fixtures/campaign-strategist";
import { blueprintFixture } from "../fixtures/blueprint";
import { memoryFixture } from "../fixtures/memory";
import { generateCampaignStrategies } from "../../src/features/campaign-strategist/strategy-service";
import { generateBlueprint } from "../../src/features/campaign-blueprint/blueprint-service";
import { validateBlueprint } from "../../src/features/campaign-blueprint/blueprint-domain";
import { validateMemoryInterpretation, validateStoredMemory } from "../../src/features/business-memory/domain";

async function strategy(text: string) {
  return generateCampaignStrategies(discussionFixture, strategistDependencies(fakeProvider({ success: true,
    text: JSON.stringify({ ...replyFixture, reply: text }), model: "test-only", requestId: null })));
}

describe("F04 narrative boundaries", () => {
  it.each(["９９", "٩٩", "९९", "9\u200b9", "𝟡𝟡", "99"]) ("rejects unsupported numeric claim %s", async digits => {
    expect(await strategy(`Penjualan ${digits} unit tercapai.`)).toMatchObject({ success: false, error: { code: "UNSAFE_TEXT" } });
  });
  it.each([
    "Laba bersih terjamin berkat promosi.", "ROI dipastikan meningkat.",
    "Pengingat meningkatkan konversi pelanggan.", "Penjualan meningkat karena promosi.",
    "Tidak ada bukti; kampanye ini meningkatkan penjualan.", "Strategi bukan tidak menjamin penjualan.", "Penjualan akan meningkat.",
    "Stok mungkin terbatas dan promosi meningkatkan penjualan.",
  ])("rejects unsupported outcome: %s", async text => {
    expect(await strategy(text)).toMatchObject({ success: false, error: { code: "UNSAFE_TEXT" } });
  });
  it.each([
    "Penjualan berpotensi meningkat.", "Strategi ini belum menjamin peningkatan penjualan.",
    "Risiko: promosi mungkin tidak menghasilkan pesanan tambahan.", "Target kampanye adalah 40 unit.",
    "Target kampanye adalah ４０ unit.", "Estimasi biaya promosi Rp50.000.",
    "Tidak ada bukti bahwa promosi menyebabkan peningkatan penjualan.", "Pengamatan mencatat 30 unit.",
  ])("accepts grounded target/estimate or uncertainty: %s", async text => {
    expect(await strategy(text)).toMatchObject({ success: true, data: { reply: text, options: [{}, {}] } });
  });
  it("accepts the owner's exact promotion estimate without turning it into observed revenue", async () => {
    const reply = structuredClone(replyFixture); reply.options[0].assumedPromotionCostIdr = 100000;
    reply.reply = "Estimasi biaya promosi Rp100.000.";
    const result = await generateCampaignStrategies({ ...discussionFixture, preferences: { ...discussionFixture.preferences, budgetCapIdr: 100000 } },
      strategistDependencies(fakeProvider({ success: true, text: JSON.stringify(reply), model: "test-only", requestId: null })));
    expect(result).toMatchObject({ success: true, data: { options: [{ computedScenario: { scenarioRevenueIdr: 480000, scenarioContributionIdr: 80000 } }, {}] } });
    expect(await strategy("Penjualan 40 unit tercapai.")).toMatchObject({ success: false });
    expect(await strategy("Estimasi biaya promosi Rp999.999.")).toMatchObject({ success: false });
  });
  it.each(["goal", "hypothesis", "audienceHypothesis", "rationale", "risks", "dependencies", "ownerChecklist", "task-title", "task-description", "caption", "assumptions", "kpi", "notes"])("rejects unsafe Blueprint %s", async field => {
    const f = await blueprintFixture(), body = await generateBlueprint(f.input, f.dependencies);
    const text = "Dijamin laba Rp999999 karena kampanye ini.";
    if (field === "goal" || field === "hypothesis" || field === "audienceHypothesis" || field === "rationale") body[field] = text;
    else if (field === "risks" || field === "dependencies" || field === "ownerChecklist" || field === "assumptions") body[field] = [text];
    else if (field === "task-title") body.tasks[0].title = text;
    else if (field === "task-description") body.tasks[0].description = text;
    else if (field === "caption") body.contents[0].body = text;
    else if (field === "kpi") body.kpiPlan.definition = text;
    else body.revision.notes = text;
    expect(() => validateBlueprint(body, f.contextInput, f.dependencies.now())).toThrow();
  });
  it("accepts Blueprint targets/estimates bound to the server calculation", async () => {
    const f = await blueprintFixture(), body = await generateBlueprint(f.input, f.dependencies);
    body.goal = `Target kampanye adalah ${body.targetAdditionalUnits} unit.`;
    body.rationale = `Estimasi biaya promosi Rp${body.budgetCapIdr}. Strategi ini belum menjamin peningkatan penjualan.`;
    expect(validateBlueprint(body, f.contextInput, f.dependencies.now()).financial.calculation).toEqual(body.financial.calculation);
  });
  it("validates grounded caption prices/discounts and rejects mismatched values", async () => {
    const f = await blueprintFixture(), body = await generateBlueprint(f.input, f.dependencies);
    body.contents[0].body = "Harga preorder Rp120.000. Diskon 0%.";
    expect(validateBlueprint(body, f.contextInput, f.dependencies.now()).contents[0].body).toBe(body.contents[0].body);
    body.contents[0].body = "Harga preorder Rp999.999.";
    expect(() => validateBlueprint(body, f.contextInput, f.dependencies.now())).toThrow("INVALID_CONTENT");
  });
  it("rejects an unsupported alternative without discarding the other valid strategy", async () => {
    const reply = structuredClone(replyFixture); reply.options[0].hypothesis = "Laba bersih terjamin berkat promosi.";
    const result = await generateCampaignStrategies(discussionFixture, strategistDependencies(fakeProvider({ success: true,
      text: JSON.stringify(reply), model: "test-only", requestId: null })));
    expect(result).toMatchObject({ success: true, data: { options: [{ proposalKey: reply.options[1].proposalKey }], rejectedOptions: [{ index: 0, code: "UNSAFE_TEXT" }] } });
  });
  it.each(["summary", "lessons", "risks", "recommendations"] as const)("rejects unsafe Memory %s", async field => {
    const f = await memoryFixture(), text = "Penjualan ９９ unit tercapai. Laba bersih terjamin berkat promosi.";
    const output = { ...f.row.lessons_json.interpretation, [field]: field === "summary" ? text : [text] };
    expect(() => validateMemoryInterpretation(output, f.source)).toThrow("UNSAFE_MEMORY_TEXT");
  });
  it.each([
    "Pesan pengingat telah dikirim kepada pelanggan.", "Pemilik sudah mengirim pesan promosi.",
    "Pengiriman pengingat jadwal preorder mencatatkan hasil melampaui target unit awal.", "Pesan pengingat dikirim kepada pelanggan.",
    "Rencanakan pengiriman pesan dan pesan pengingat telah dikirim kepada pelanggan.",
  ])("does not turn a planned action into completed external execution: %s", async summary => {
    const f = await memoryFixture();
    expect(f.source.results.executionBps).toBeLessThan(10000);
    expect(() => validateMemoryInterpretation({ ...f.row.lessons_json.interpretation, summary }, f.source)).toThrow("UNSAFE_MEMORY_TEXT");
  });
  it("complete manual checklists still do not prove external execution or conversion", async () => {
    const f = await memoryFixture(); f.source.results.executionBps = 10000;
    const output = { ...f.row.lessons_json.interpretation, executionState: "complete", summary: "Pesan promosi telah dikirim dan meningkatkan konversi." };
    expect(() => validateMemoryInterpretation(output, f.source)).toThrow("UNSAFE_MEMORY_TEXT");
  });
  it.each(["Pesan pengingat belum dikirim kepada pelanggan.", "Pesan pengingat akan dikirim oleh pemilik."])("accepts negated or planned execution: %s", async summary => {
    const f = await memoryFixture();
    expect(validateMemoryInterpretation({ ...f.row.lessons_json.interpretation, summary }, f.source).summary).toBe(summary);
  });
  it("rejects completed-checklist prose when the source checklist is incomplete", async () => {
    const f = await memoryFixture();
    expect(() => validateMemoryInterpretation({ ...f.row.lessons_json.interpretation, summary: "Seluruh checklist lengkap." }, f.source)).toThrow("UNSAFE_MEMORY_TEXT");
  });
  it("accepts bounded Memory observations/targets/estimates and preserves synthetic provenance", async () => {
    const f = await memoryFixture();
    const summary = `Target kampanye adalah ${f.source.results.plannedAdditionalUnits} unit. Estimasi biaya promosi Rp${f.source.results.budgetCapIdr}.`;
    const output = { ...f.row.lessons_json.interpretation, summary, recommendations: ["Rencanakan pengiriman pengingat; pelaksanaan eksternal belum terverifikasi.", "Strategi ini belum menjamin peningkatan penjualan."] };
    expect(validateMemoryInterpretation(output, f.source)).toEqual(output);
    expect(f.source).toMatchObject({ synthetic: true, productionEligible: false });
    expect(validateStoredMemory(f.row)).toEqual(f.row);
  });
  it("retains historical synthetic Memory wording without accepting it as a new candidate", async () => {
    const f = await memoryFixture();
    const summary = "Pengiriman pengingat jadwal preorder mencatatkan hasil melampaui target unit awal.";
    const { memoryContentHash } = await import("../../src/features/business-memory/domain");
    const row = { ...f.row, summary_text: summary, lessons_json: { ...f.row.lessons_json, interpretation: { ...f.row.lessons_json.interpretation, summary } } };
    row.content_hash = memoryContentHash(row);
    expect(validateStoredMemory(row)).toEqual(row);
    expect(() => validateMemoryInterpretation(row.lessons_json.interpretation, f.source)).toThrow("UNSAFE_MEMORY_TEXT");
    expect(row.lessons_json.source).toMatchObject({ synthetic: true, productionEligible: false });
  });
});
