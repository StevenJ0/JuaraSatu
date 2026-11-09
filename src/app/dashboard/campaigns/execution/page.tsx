import type { Metadata } from "next";
import { site } from "@/config/site";
import { requireBusinessOwner } from "@/features/business/guard";
import { OwnerExecutionPage } from "@/features/campaign-execution/components/owner-execution";

export const metadata: Metadata = { title: `Eksekusi kampanye | ${site.name}` };

export default async function OwnerExecutionRoute() {
  await requireBusinessOwner();
  return <OwnerExecutionPage />;
}
