import { MemoryError, type MemoryProvider } from "./contracts";
import { memoryAssessments } from "./domain";
export type MemoryEnvironment = { NODE_ENV?: string; CAMPAIGN_MEMORY_PROVIDER?: string };
export function memoryDevelopmentEnabled(env: MemoryEnvironment) { return ["development", "test"].includes(env.NODE_ENV ?? "") && ["fake", "gemini"].includes(env.CAMPAIGN_MEMORY_PROVIDER ?? ""); }
export function fakeMemoryProvider(scenario: "valid" | "failure" | "invalid" | "missing_evidence", env: MemoryEnvironment): MemoryProvider {
  if (!memoryDevelopmentEnabled(env) || env.CAMPAIGN_MEMORY_PROVIDER !== "fake") throw new MemoryError("FAKE_MEMORY_DISABLED", 503);
  return { async generate(source) {
    if (scenario === "failure") throw new Error("Synthetic provider failure");
    if (scenario === "invalid") return { summary: "Dijamin penjualan naik 999 persen", revenue: 999999 };
    const states = memoryAssessments(source);
    return { businessId: source.businessId, campaignId: source.campaignId, sourceEvaluationId: source.evaluationId, sourceVersion: source.sourceVersion,
      ...states, ...(scenario === "missing_evidence" ? { sourceEvaluationId: null } : {}),
      summary: states.outcome === "above_target" ? "Pengamatan simulasi mencapai target rencana; hasil ini perlu dibaca bersama pengeluaran dan keterbatasannya." : "Pengamatan simulasi belum menunjukkan target rencana tercapai; evaluasi keterbatasan sebelum mengulang pendekatan.",
      lessons: [source.results.budgetVarianceIdr !== null && source.results.budgetVarianceIdr > 0 ? "Pengeluaran melampaui budget rencana dan mengurangi kontribusi skenario." : "Budget rencana perlu dibandingkan dengan pengeluaran yang telah ditinjau.",
        states.executionState === "complete" ? "Checklist lengkap tetap merupakan konfirmasi manual pemilik." : "Checklist yang belum lengkap membatasi pembacaan pelaksanaan."],
      risks: ["Sumber sintetis belum menjadi pengalaman usaha terverifikasi.", "Pengamatan historis tidak membuktikan dampak kausal campaign."],
      recommendations: [states.financialState === "positive" ? "Tinjau ulang batas belanja sebelum mempertimbangkan pendekatan serupa." : "Lengkapi bukti biaya sebelum membuat keputusan finansial.", "Periksa fakta preorder terbaru sebelum menggunakan pembelajaran ini."],
      evidenceReferences: ["campaign", "blueprint", "execution", "costs", ...(source.results.observed.paidUnitsInWindow === null ? [] : ["c6"])] };
  } };
}
