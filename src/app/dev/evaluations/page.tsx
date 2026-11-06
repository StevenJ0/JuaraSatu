import { notFound } from "next/navigation";
import { EvaluationWorkspace } from "@/features/campaign-evaluation/components/evaluation-workspace";
export default function CampaignEvaluationPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <EvaluationWorkspace />;
}
