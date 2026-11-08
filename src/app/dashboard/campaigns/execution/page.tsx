import { requireBusinessOwner } from "@/features/business/guard";
import { ExecutionWorkspace } from "@/features/campaign-execution/components/execution-workspace";
export default async function OwnerExecutionPage() {
  await requireBusinessOwner();
  return <ExecutionWorkspace owner />;
}
