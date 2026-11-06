import { describe, expect, it } from "vitest";
import { evaluationFixture, evaluationEnvironment } from "../fixtures/evaluation";
import { calculateEvaluation } from "../../src/features/campaign-evaluation/calculate";
import { validateEvaluationNarrative } from "../../src/features/campaign-evaluation/engine";
import { EvaluationNarrativeSchema } from "../../src/features/campaign-evaluation/contracts";
import { developmentEvaluationProvider } from "../../src/features/campaign-evaluation/development-provider";

async function narrativeFixture(scenario = "exceeds_target") {
  const f = await evaluationFixture(scenario), summary = calculateEvaluation(f.context);
  const narrative = EvaluationNarrativeSchema.parse(await developmentEvaluationProvider("valid", evaluationEnvironment)
    .generate({ summary, references: f.context.references }));
  return { ...f, summary, narrative };
}
describe("Indonesian evaluation claim safety", () => {
  it.each([
    "Terdapat ketidakpastian hasil promosi.",
    "Hasil ini belum dapat dipastikan.",
    "Hasil ini tidak dapat dipastikan.",
    "Peningkatan penjualan belum pasti.",
    "Peningkatan penjualan tidak dijamin.",
    "Tidak ada kepastian hasil promosi.",
    "Peningkatan penjualan belum ada kepastiannya.",
    "Hasil ini BELUM BISA DIPASTIKAN.",
    "Hasil promosi belum\u00a0dapat dipastikan.",
  ])("accepts bounded uncertainty: %s", async summary => {
    const f = await narrativeFixture();
    expect(validateEvaluationNarrative({ ...f.narrative, summary }, f.context, f.summary).summary).toBe(summary);
  });
  it.each([
    "Penjualan pasti meningkat.",
    "Penjualan pastinya meningkat.",
    "Ada kepastian penjualan meningkat.",
    "Penjualan dijaminnya meningkat.",
    "Bukannya tidak pasti meningkat.",
    "Penjualan meningkat karena kampanye.",
    "Kenaikan berkat promosi.",
    "Kampanye meningkatkan penjualan.",
    "Penjualan bukan tidak pasti meningkat.",
    "Penjualan tidak mungkin tidak pasti meningkat.",
    "Tidak. Pasti meningkat.",
    "Belum; dijamin meningkat.",
    "Peningkatan penjualan dipastikan.",
    "Penjualan dijamin meningkat.",
    "Penjualan PASTI meningkat!",
    "Penjualan \uff50\uff41\uff53\uff54\uff49 meningkat.",
    "Penjualan pa\u200bsti meningkat.",
    "Tidak ada bukti; penjualan pasti meningkat.",
    "Penjualan tidak hanya pasti meningkat, tetapi dijamin berhasil.",
    "Penjualan belum pasti; keuntungan dijamin.",
    "Penjualan tidak meningkat. Pasti meningkat berikutnya.",
    "Campaign menyebabkan peningkatan penjualan.",
    "Kenaikan disebabkan promosi.",
    "Hasil ini berkat campaign.",
    "Campaign caused sales growth.",
    "Guaranteed sales growth.",
    "Penjualan mencapai 999 unit.",
    "Penjualan mencapai \uff11\uff12 unit.",
    "Penjualan mencapai \u0661\u0662 unit.",
    "Pendapatan mencapai Rp seribu.",
    "Pendapatan mencapai seribu rupiah.",
    "Penjualan mencapai dua belas unit.",
  ])("rejects unsupported or fabricated claims: %s", async summary => {
    const f = await narrativeFixture();
    expect(() => validateEvaluationNarrative({ ...f.narrative, summary }, f.context, f.summary)).toThrow();
  });
  it.each(["outcome", "financialState", "executionState"] as const)("rejects mismatched %s", async field => {
    const f = await narrativeFixture();
    const wrong = { outcome: "below_target", financialState: "unknown", executionState: "complete" };
    expect(() => validateEvaluationNarrative({ ...f.narrative, [field]: wrong[field] }, f.context, f.summary)).toThrow();
  });
  it("rejects references not available in this context", async () => {
    const f = await narrativeFixture("unavailable");
    expect(() => validateEvaluationNarrative({ ...f.narrative, evidenceReferences: ["c6"] }, f.context, f.summary)).toThrow();
  });
});

it.each(["Tidak semua tugas selesai.", "Belum seluruh checklist selesai.", "Seluruh checklist selesai belum dapat dipastikan."])("accepts negated checklist claim: %s", async executionAnalysis => {
  const f = await narrativeFixture();
  expect(validateEvaluationNarrative({ ...f.narrative, executionAnalysis }, f.context, f.summary).executionAnalysis).toBe(executionAnalysis);
});
it.each(["Tidak ada kontribusi positif.", "Kontribusi positif belum dapat dipastikan."])("accepts uncertain financial claim: %s", async financialAnalysis => {
  const f = await narrativeFixture("missing_cost");
  expect(validateEvaluationNarrative({ ...f.narrative, financialAnalysis }, f.context, f.summary).financialAnalysis).toBe(financialAnalysis);
});
it.each([
  ["below_target", "summary", "Target tercapai."],
  ["missing_cost", "financialAnalysis", "Kontribusi positif."],
  ["exceeds_target", "executionAnalysis", "Tidak semua tugas selesai; seluruh checklist selesai."],
])("rejects contradictory %s prose", async (scenario, field, text) => {
  const f = await narrativeFixture(scenario);
  expect(() => validateEvaluationNarrative({ ...f.narrative, [field]: text }, f.context, f.summary)).toThrow();
});
it("does not let negation in one field authorize a guarantee in another", async () => {
  const f = await narrativeFixture();
  expect(() => validateEvaluationNarrative({ ...f.narrative, summary: "Hasil belum", kpiAnalysis: "pasti meningkat." }, f.context, f.summary)).toThrow();
});
