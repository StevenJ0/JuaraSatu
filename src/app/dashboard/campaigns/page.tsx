import { requireBusinessOwner } from "@/features/business/guard";
import { DiscussionWorkspace } from "@/features/campaign-strategist/components/discussion-workspace";
export default async function OwnerCampaignPage() {
  await requireBusinessOwner();
  return <DiscussionWorkspace owner />;
}
