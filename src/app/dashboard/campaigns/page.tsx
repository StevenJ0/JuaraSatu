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
  const facts: Record<string, PreorderFacts> = Object.fromEntries((await listPreorders(supabase, businessId)).map((preorder) => [preorder.id, {
    productName: preorder.productName, basePriceIdr: preorder.basePriceIdr, targetUnits: preorder.targetUnits,
    paidUnits: preorder.metrics.paidUnits, orderableUnits: preorder.metrics.orderableUnits, startsAt: preorder.startsAt, endsAt: preorder.endsAt,
  }]));
  return <CampaignHub facts={facts} />;
}
