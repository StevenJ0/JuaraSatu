import { fingerprint } from "../campaign-blueprint";
import { PublicationBaselineSchema } from "../campaign-execution/contracts";
import { assertMaterializedPlan } from "../campaign-execution";
import { supabaseUtcTimestamp } from "@/lib/supabase/timestamps";
import { AnalyticsReadSchema, AnalyticsScenarioSchema, CostSchema, EvaluationContextSchema, EvaluationError, type AnalyticsRead, type EvaluationContext } from "./contracts";
import { z } from "zod";
import { ExecutionSnapshotSchema } from "../campaign-execution/contracts";

export function evaluationWindow(snapshot: z.infer<typeof ExecutionSnapshotSchema>, now: string) {
  const c = snapshot.campaign;
  if (!c.published_at || !c.closed_at) throw new EvaluationError("CLOSED_CAMPAIGN_REQUIRED");
  const startsAt = Date.parse(c.published_at) > Date.parse(c.starts_at) ? c.published_at : c.starts_at;
  const end = [c.ends_at, c.closed_at, now].sort((a, b) => Date.parse(a) - Date.parse(b))[0];
  if (Date.parse(startsAt) > Date.parse(end)) throw new EvaluationError("INVALID_MEASUREMENT_WINDOW");
  return { startsAt: supabaseUtcTimestamp(startsAt), endsAt: supabaseUtcTimestamp(end) };
}
export function buildEvaluationContext(input: { snapshot: unknown; costs: unknown; costsCompleteness: unknown; analytics: AnalyticsRead; analyticsScenario: unknown; now: string }): EvaluationContext {
  const snapshot = ExecutionSnapshotSchema.parse(input.snapshot); const now = z.iso.datetime({ offset: true }).parse(input.now);
  if (!["closed", "completed"].includes(snapshot.campaign.status)) throw new EvaluationError("CLOSED_CAMPAIGN_REQUIRED");
  assertMaterializedPlan(snapshot); const baseline = PublicationBaselineSchema.parse(snapshot.campaign.baseline_json);
  const normalizedSnapshot = { ...snapshot, campaign: { ...snapshot.campaign, baseline_json: baseline } };
  if (baseline.sourceVersions.businessId !== snapshot.campaign.business_id || baseline.sourceVersions.preorderId !== snapshot.campaign.preorder_id) throw new EvaluationError("SOURCE_MISMATCH");
  const costs = z.array(CostSchema).max(100).parse(input.costs).sort((a, b) => a.id.localeCompare(b.id));
  if (new Set(costs.map((c) => c.id)).size !== costs.length || costs.some((c) => c.business_id !== snapshot.campaign.business_id || c.campaign_id !== snapshot.campaign.id)) throw new EvaluationError("SOURCE_MISMATCH");
  const costsCompleteness = z.enum(["unreviewed", "confirmed_complete"]).parse(input.costsCompleteness);
  const analytics = AnalyticsReadSchema.parse(input.analytics); const analyticsScenario = AnalyticsScenarioSchema.parse(input.analyticsScenario);
  const window = evaluationWindow(snapshot, now);
  if (analytics.status === "available") {
    const data = analytics.data;
    if (data.businessId !== snapshot.campaign.business_id || data.preorderId !== snapshot.campaign.preorder_id || data.campaignId !== snapshot.campaign.id ||
      data.campaignVersion !== snapshot.campaign.version || supabaseUtcTimestamp(data.window.startsAt) !== window.startsAt || supabaseUtcTimestamp(data.window.endsAt) !== window.endsAt) throw new EvaluationError("SOURCE_MISMATCH");
    if (Date.parse(now) - Date.parse(data.calculatedAt) > 60_000 || Date.parse(data.calculatedAt) > Date.parse(now)) throw new EvaluationError("STALE_ANALYTICS");
  }
  const limitations = ["Checklist adalah konfirmasi manual, bukan bukti posting atau penjualan.", "Hasil pengamatan tidak membuktikan dampak sebab-akibat campaign.",
    "Evaluasi sintetis tetap tidak eligible sebagai pengalaman bisnis terverifikasi, termasuk setelah penyelesaian simulasi."];
  if (analytics.status === "unavailable") limitations.push("C6 belum tersedia; KPI yang tidak diketahui tetap null, bukan nol.");
  else {
    if (analytics.data.provenance === "development_fixture") limitations.push("Semua KPI C6 ini simulasi development; tidak ada order atau pembayaran terverifikasi yang dibuat.");
    if (analytics.data.provenance === "sandbox") limitations.push("KPI Sandbox bukan penerimaan uang nyata.");
    if (analytics.data.isProvisional) limitations.push("Snapshot KPI masih provisional.");
    if (!analytics.data.costsComplete) limitations.push("Ledger biaya produksi belum lengkap; kontribusi tidak diketahui.");
  }
  if (costsCompleteness !== "confirmed_complete") limitations.push("Biaya promosi tercatat belum dikonfirmasi lengkap; total final belum diketahui.");
  const refs = ["campaign", "blueprint", "baseline", "execution", "costs", ...(analytics.status === "available" ? ["c6"] : [])];
  const stableAnalytics = analytics.status === "available" ? { ...analytics, data: { ...analytics.data, calculatedAt: undefined } } : analytics;
  const contextHash = fingerprint({ snapshot: normalizedSnapshot, costs, costsCompleteness, analytics: stableAnalytics, analyticsScenario });
  return EvaluationContextSchema.parse({ schemaVersion: 1, snapshot: normalizedSnapshot, costs, costsCompleteness, analytics, analyticsScenario, calculatedAt: now, contextHash, references: refs, limitations });
}
