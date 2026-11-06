import { notFound } from "next/navigation";
import { ExecutionWorkspace } from "@/features/campaign-execution/components/execution-workspace";

export default function CampaignExecutionPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <ExecutionWorkspace />;
}
