import { createHash } from "node:crypto";
import type { CampaignContextV1 } from "./contracts";

type CanonicalValue = null | boolean | number | string | CanonicalValue[] | { [key: string]: CanonicalValue };

function canonicalize(value: CanonicalValue): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
}

export function hashContext(context: Omit<CampaignContextV1, "contextHash">): string {
  const { business, product, preorder, effectiveOffer, analytics, hypotheticalScenario, history, constraints } = context;
  const { c1, c6, c8 } = context.metadata.sources;
  const facts = {
    schemaVersion: context.schemaVersion,
    business, product, preorder, effectiveOffer, analytics, hypotheticalScenario,
    history: history.status === "available" ? {...history,memories:history.memories.map(({similarity,...memory})=>{void similarity;return memory;}).sort((a,b)=>a.memoryId.localeCompare(b.memoryId))} : history, constraints,
    sourceVersions: {
      c1: [c1.preorderVersion, c1.preorderItemVersion, c1.productVersion, c1.capacityVersion],
      c6: analytics.status === "available" && c6 !== null
        ? [c6.preorderVersion, c6.preorderItemVersion, c6.productVersion, c6.capacityVersion, c6.metricsSchemaVersion] : null,
      c8: [c8.preorderVersion, c8.preorderItemVersion, c8.offerVersion],
    },
  };
  return createHash("sha256").update(canonicalize(facts)).digest("hex");
}
