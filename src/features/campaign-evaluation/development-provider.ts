import { calculateOrderPrice } from "../pricing";
import { evaluationWindow } from "./context";
import { PublicationBaselineSchema } from "../campaign-execution/contracts";
import { AnalyticsScenarioSchema, CampaignAnalyticsSnapshotSchema, EvaluationError, Money, type AnalyticsRead, type EvaluationProvider } from "./contracts";
import { evaluationAssessments } from "./calculate";
import type { ExecutionSnapshot } from "../campaign-execution/contracts";

export type EvaluationEnvironment = { NODE_ENV?: string; CAMPAIGN_EVALUATION_MODE?: string };
export function evaluationDevelopmentEnabled(env: EvaluationEnvironment) { return ["development", "test"].includes(env.NODE_ENV ?? "") && env.CAMPAIGN_EVALUATION_MODE === "synthetic"; }
export function syntheticCampaignAnalytics(snapshot: ExecutionSnapshot, scenarioInput: unknown, now: string, env: EvaluationEnvironment): AnalyticsRead {
  if (!evaluationDevelopmentEnabled(env)) throw new EvaluationError("SYNTHETIC_EVALUATION_DISABLED", 503);
  const scenario = AnalyticsScenarioSchema.parse(scenarioInput); if (scenario === "unavailable") return { status: "unavailable", reason: "not_implemented" };
  const bp = snapshot.blueprint?.blueprint_json; if (!bp) throw new EvaluationError("INVALID_EXECUTION_PLAN");
  const units = scenario === "exceeds_target" ? Math.min(bp.targetAdditionalUnits + 2, 10000) : scenario === "high_spend" ? 2 : Math.max(1, Math.floor(bp.targetAdditionalUnits / 2));
  const price = calculateOrderPrice({ baseUnitPriceIdr: snapshot.item.base_price_snapshot_idr, offer: { offerType: bp.offer.type, discountBps: bp.offer.discountBps }, quantity: units });
  if (!price.success) throw new EvaluationError("NUMERIC_RANGE", 400);
  return { status: "available", data: CampaignAnalyticsSnapshotSchema.parse({ schemaVersion: 1, businessId: snapshot.campaign.business_id, preorderId: snapshot.campaign.preorder_id,
    campaignId: snapshot.campaign.id, sourceId: `development-${scenario}`, sourceVersion: 1, campaignVersion: snapshot.campaign.version, calculatedAt: now,
    provenance: "development_fixture", isProvisional: true, costsComplete: scenario !== "missing_cost" && bp.financial.variableCostIdr !== null,
    operationallyResolved: scenario === "provisional" ? null : true, window: evaluationWindow(snapshot, now), financialScope: "distinct_union_attribution_or_pricing", financialScopeOrderIds: null,
    metrics: { currentPreorderPaidUnits: PublicationBaselineSchema.parse(snapshot.campaign.baseline_json).baseline_preorder_paid_units + units, paidUnitsInWindow: units,
      attributedPaidUnits: Math.min(5, units), attributedPaidUnitsLifetime: Math.min(5, units), discountedPaidUnits: bp.offer.type === "percent_discount" ? units : 0,
      scopedFulfilledSalesValueIdr: price.data.totalIdr, scopedProductionCostIncurredIdr: scenario === "missing_cost" || bp.financial.variableCostIdr === null ? null : Money.parse(bp.financial.variableCostIdr * units),
      discountValueAppliedIdr: price.data.discountTotalIdr } }) };
}
export function developmentEvaluationProvider(scenario: "valid" | "failure" | "invalid", env: EvaluationEnvironment): EvaluationProvider {
  if (!evaluationDevelopmentEnabled(env)) throw new EvaluationError("SYNTHETIC_EVALUATION_DISABLED", 503);
  return { async generate({ summary: s, references }) {
    if (scenario === "failure") throw new EvaluationError("PROVIDER_UNAVAILABLE", 503);
    if (scenario === "invalid") return { summary: "Penjualan dijamin meningkat 999 persen", evidenceReferences: ["invented-source"] };
    const states = evaluationAssessments(s);
    return { ...states, summary: states.outcome === "above_target" ? "Pengamatan simulasi berada pada atau di atas target rencana." : states.outcome === "below_target" ? "Pengamatan simulasi belum mencapai target rencana." : "Data pengamatan belum tersedia untuk menilai target.",
      kpiAnalysis: "Unit dalam measurement window berbeda dari unit atribusi tautan maupun unit penerima harga campaign.",
      financialAnalysis: s.contributionIdr === null ? "Kontribusi belum diketahui karena sumber biaya atau KPI belum lengkap." : s.budgetVarianceIdr !== null && s.budgetVarianceIdr > 0 ? "Pengeluaran promosi tercatat melampaui budget dan mengurangi kontribusi skenario." : "Kontribusi dihitung dari scope keuangan dan pengeluaran yang ditinjau; ini bukan laba bersih.",
      executionAnalysis: states.executionState === "complete" ? "Seluruh checklist dicentang pemilik; posting eksternal belum diverifikasi." : "Sebagian checklist belum selesai; pelaksanaan perlu ditinjau pemilik.",
      successes: [states.outcome === "above_target" ? "Target rencana tercakup dalam pengamatan simulasi." : "Rencana dan sumber pengamatan sudah dipisahkan."],
      shortfalls: [states.outcome === "below_target" ? "Pengamatan simulasi berada di bawah target." : "Bukti dampak kausal dan hasil produksi belum tersedia."],
      risks: ["Simulasi KPI bukan transaksi atau penerimaan uang yang terverifikasi."], recommendations: ["Tinjau biaya dan checklist sebelum merencanakan campaign berikutnya.", "Gunakan producer KPI terotorisasi untuk evaluasi operasional."],
      evidenceReferences: references, warnings: ["Fake Evaluation dan KPI development harus tetap diberi label sintetis.", "Tidak ada bukti sebab-akibat dari snapshot ini."] };
  } };
}
