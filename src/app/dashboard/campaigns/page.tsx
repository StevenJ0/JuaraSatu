import type { Metadata } from "next";
import { site } from "@/config/site";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireBusinessOwner } from "@/features/business/guard";
import { listPreorders } from "@/features/preorders/repository";
import { CampaignHub, type PreorderFacts } from "@/features/campaign-strategist/components/campaign-hub";

export const metadata: Metadata = { title: `Campaign AI | ${site.name}` };

export default async function OwnerCampaignPage() {
  const { businessId } = await requireBusinessOwner();
  const supabase = await createSupabaseServerClient();
  // Display-only facts for the hub header; the AI itself always re-reads the authoritative context on the server.
  // A preorder row the list cannot read (e.g. legacy data without pickup terms) hides the header numbers instead of the whole hub.
  const preorders = await listPreorders(supabase, businessId).catch((error: unknown) => {
    console.error("[campaigns] ringkasan preorder gagal dibaca", { name: error instanceof Error ? error.name : "unknown" });
    return [];
  });
  const facts: Record<string, PreorderFacts> = Object.fromEntries(preorders.map((preorder) => [preorder.id, {
    productName: preorder.productName, basePriceIdr: preorder.basePriceIdr, targetUnits: preorder.targetUnits,
    paidUnits: preorder.metrics.paidUnits, orderableUnits: preorder.metrics.orderableUnits, startsAt: preorder.startsAt, endsAt: preorder.endsAt,
  }]));
  return <CampaignHub facts={facts} />;
}
