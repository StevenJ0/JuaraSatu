import { calculateUnitPrice } from "../pricing";
import { simulateCampaign } from "../campaign-simulator";
import {
  BuildBusinessContextInputSchema, CampaignContextV1Schema,
  type CampaignContextV1, type ContextBuildError, type ContextBuildResult,
} from "./contracts";
import { hashContext } from "./context-hash";

function failure(code: ContextBuildError["code"], source: ContextBuildError["source"], field: string): ContextBuildResult {
  const messages = {
    INVALID_INPUT: "Input context tidak memenuhi kontrak. Periksa field sumber tanpa mengirim data privat.",
    SOURCE_UNAVAILABLE: "Producer yang diperlukan tidak tersedia. Tidak ada fallback facts buatan.",
    STALE_SOURCE: "Snapshot kedaluwarsa, berasal dari masa depan, atau eligibility sudah berubah. Baca ulang producer.",
    SOURCE_MISMATCH: "Identitas, versi, atau fakta lintas producer tidak konsisten. Baca ulang sumber yang diotorisasi.",
    INVALID_SCENARIO: "Skenario hipotetis tidak dapat dihitung dalam kontrak simulator.",
  };
  return { success: false, errors: [{ code, source, field, message: messages[code] }] };
}

/** Pure Node function: caller owns auth, producer reads and the authoritative request clock. */
export function buildBusinessContext(input: unknown): ContextBuildResult {
  const parsed = BuildBusinessContextInputSchema.safeParse(input);
  if (!parsed.success) return failure("INVALID_INPUT", "input", parsed.error.issues[0]?.path.map(String).join(".") || "input");
  const request = parsed.data;
  if (request.c1.status !== "available") return failure("SOURCE_UNAVAILABLE", "c1", "status");
  if (request.c8.status !== "available") return failure("SOURCE_UNAVAILABLE", "c8", "status");
  const c1 = request.c1.data;
  const c8 = request.c8.data;
  const c6 = request.c6.status === "available" ? request.c6.data : null;
  const { business, product, preorder, snapshot } = c1;
  const scope = request.scope;
  if (business.businessId !== scope.businessId || product.businessId !== scope.businessId ||
    preorder.businessId !== scope.businessId || preorder.preorderId !== scope.preorderId ||
    product.productId !== preorder.productId) return failure("SOURCE_MISMATCH", "c1", "identity");
  if (c8.businessId !== scope.businessId || c8.preorderId !== scope.preorderId ||
    c8.preorderItemId !== preorder.preorderItemId || c8.productId !== product.productId) {
    return failure("SOURCE_MISMATCH", "c8", "identity");
  }
  if (c6 !== null && (c6.businessId !== scope.businessId || c6.preorderId !== scope.preorderId ||
    c6.preorderItemId !== preorder.preorderItemId || c6.productId !== product.productId)) {
    return failure("SOURCE_MISMATCH", "c6", "identity");
  }
  if (["cold_start","no_match","available"].includes(request.history.status) && "businessId" in request.history && request.history.businessId !== scope.businessId) {
    return failure("SOURCE_MISMATCH", "history", "businessId");
  }
  if (request.history.status === "available" && (new Set(request.history.memories.map((m)=>m.memoryId)).size !== request.history.memories.length ||
    request.history.memories.some((m)=>m.businessId!==scope.businessId || m.provenance==="isolated_test" && snapshot.provenance!=="development_fixture"))) return failure("SOURCE_MISMATCH","history","memories");

  const now = Date.parse(request.calculatedAt);
  function fresh(timestamp: string) {
    const age = now - Date.parse(timestamp);
    return age >= 0 && age <= request.maxSourceAgeSeconds * 1_000;
  }
  if (!fresh(snapshot.calculatedAt)) return failure("STALE_SOURCE", "c1", "snapshot.calculatedAt");
  if (!fresh(c8.snapshot.calculatedAt)) return failure("STALE_SOURCE", "c8", "snapshot.calculatedAt");
  if (c8.snapshot.provenance !== snapshot.provenance ||
    c8.snapshot.preorderVersion !== snapshot.preorderVersion ||
    c8.snapshot.preorderItemVersion !== snapshot.preorderItemVersion ||
    c8.baseUnitPriceIdr !== preorder.baseUnitPriceIdr) return failure("SOURCE_MISMATCH", "c8", "snapshot");
  if (c6 !== null && c6.snapshot.provenance !== snapshot.provenance) return failure("SOURCE_MISMATCH", "c6", "snapshot.provenance");

  const current = c8.effectiveOffer;
  const price = calculateUnitPrice({ baseUnitPriceIdr: preorder.baseUnitPriceIdr, offer: current.offer });
  if (!price.success || price.data.finalUnitPriceIdr !== current.unitPriceIdr) return failure("SOURCE_MISMATCH", "c8", "effectiveOffer.unitPriceIdr");
  const isOrderIntakeOpen = preorder.preorderStatus === "published" &&
    now >= Date.parse(preorder.startsAt) && now < Date.parse(preorder.endsAt);
  if (current.state === "active") {
    const campaign = current.campaign;
    if (campaign.businessId !== scope.businessId || campaign.preorderId !== scope.preorderId ||
      Date.parse(campaign.startsAt) >= Date.parse(campaign.endsAt) ||
      Date.parse(campaign.startsAt) < Date.parse(preorder.startsAt) ||
      Date.parse(campaign.endsAt) > Date.parse(preorder.endsAt)) return failure("SOURCE_MISMATCH", "c8", "effectiveOffer.campaign");
    if (!isOrderIntakeOpen || now < Date.parse(campaign.startsAt) || now >= Date.parse(campaign.endsAt) ||
      now < Date.parse(campaign.publishedAt)) return failure("STALE_SOURCE", "c8", "effectiveOffer.campaign");
  }

  let analytics: CampaignContextV1["analytics"];
  if (request.c6.status === "unavailable") {
    if (request.analyticsRequirement === "required" || request.c6.reason === "forbidden") {
      return failure("SOURCE_UNAVAILABLE", "c6", "status");
    }
    analytics = { status: "unavailable", reason: request.c6.reason };
  } else {
    const source = request.c6.data;
    const mismatch = source.snapshot.preorderVersion !== snapshot.preorderVersion ||
      source.snapshot.preorderItemVersion !== snapshot.preorderItemVersion ||
      source.snapshot.productVersion !== snapshot.productVersion ||
      source.snapshot.capacityVersion !== snapshot.capacityVersion || source.metrics.paidUnits !== preorder.paidUnits;
    const reason = !fresh(source.snapshot.calculatedAt) ? "stale" : mismatch ? "source_mismatch" : null;
    if (reason !== null && request.analyticsRequirement === "required") {
      return failure(reason === "stale" ? "STALE_SOURCE" : "SOURCE_MISMATCH", "c6", "snapshot");
    }
    analytics = reason === null ? { status: "available", metrics: source.metrics } : { status: "unavailable", reason };
  }

  let history: CampaignContextV1["history"];
  if (request.history.status === "available") {
    history = fresh(request.history.checkedAt) ? {status:"available",reason:null,memories:request.history.memories} : {status:"unavailable",reason:"stale",memories:[]};
  } else if (request.history.status === "cold_start" || request.history.status === "no_match") {
    history = fresh(request.history.checkedAt)
      ? { status: request.history.status, reason: null, memories: [] }
      : { status: "unavailable", reason: "stale", memories: [] };
  } else if (request.history.status === "unavailable") {
    if (request.history.reason === "forbidden") return failure("SOURCE_UNAVAILABLE", "history", "status");
    history = { status: "unavailable", reason: request.history.reason, memories: [] };
  } else history = { status: "not_requested", reason: null, memories: [] };

  let hypotheticalScenario: CampaignContextV1["hypotheticalScenario"] = null;
  if (request.hypotheticalScenario !== null) {
    const scenario = simulateCampaign({
      businessId: scope.businessId, preorderId: preorder.preorderId, preorderItemId: preorder.preorderItemId,
      preorderName: preorder.preorderName, productName: product.name,
      preorderStatus: preorder.preorderStatus, startsAt: preorder.startsAt, endsAt: preorder.endsAt,
      intakeCutoffAt: preorder.intakeCutoffAt, baseUnitPriceIdr: preorder.baseUnitPriceIdr,
      variableCostIdr: product.variableCostIdr, costQuality: product.costQuality, orderableUnits: preorder.orderableUnits,
      currentOffer: { preorderId: preorder.preorderId, preorderItemId: preorder.preorderItemId,
        preorderItemVersion: snapshot.preorderItemVersion, offer: current.offer, unitPriceIdr: current.unitPriceIdr,
        offerVersion: c8.snapshot.offerVersion, calculatedAt: c8.snapshot.calculatedAt },
      snapshot: { ...snapshot, calculatedAt: request.calculatedAt },
    }, request.hypotheticalScenario);
    if (!scenario.success) return failure("INVALID_SCENARIO", "hypotheticalScenario", scenario.errors[0]?.field || "input");
    const calculation = scenario.data;
    hypotheticalScenario = { input: request.hypotheticalScenario, calculation: {
      hypotheticalFinalUnitPriceIdr: calculation.hypotheticalFinalUnitPriceIdr,
      scenarioRevenueIdr: calculation.scenarioRevenueIdr, scenarioVariableCostIdr: calculation.scenarioVariableCostIdr,
      scenarioContributionIdr: calculation.scenarioContributionIdr,
      feasible: calculation.feasible, blockers: calculation.blockers, warnings: calculation.warnings,
    } };
  }

  const context = CampaignContextV1Schema.omit({ contextHash: true }).safeParse({
    schemaVersion: 1, calculatedAt: request.calculatedAt,
    business,
    product: { productId: product.productId, name: product.name, category: product.category,
      description: product.description, variableCostIdr: product.variableCostIdr, costQuality: product.costQuality },
    preorder: { ...preorder, paidTargetGapUnits: Math.max(preorder.targetUnits - preorder.paidUnits, 0), isOrderIntakeOpen },
    effectiveOffer: current, analytics, hypotheticalScenario, history,
    constraints: {
      supportedOfferTypes: ["normal_price", "percent_discount"],
      percentDiscountRequiresKnownCostAndPositiveContribution: true,
      currentFactsOverrideHistoricalMemory: true, quantitiesAreAssumptionsNotForecasts: true,
      capacityIsSnapshotNotReservation: true, externalTextIsUntrustedData: true,
    },
    metadata: { sources: { c1: snapshot, c6: c6?.snapshot ?? null, c8: c8.snapshot },
      historyCheckedAt: "checkedAt" in request.history ? request.history.checkedAt : null,
      analyticsRequirement: request.analyticsRequirement, maxSourceAgeSeconds: request.maxSourceAgeSeconds },
  });
  if (!context.success) return failure("INVALID_INPUT", "input", "context");
  return { success: true, data: { ...context.data, contextHash: hashContext(context.data) } };
}
