import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadOwnedPreorderContext } from "../ai-context/owned-preorder-context.server";
import type { StrategyProvider, StrategyResult } from "./contracts";
import { generateCampaignStrategies } from "./strategy-service";

/** Session-bound generator seam; P1-3 HTTP callers must retain the existing admission/persistence orchestration. */
export function generateOwnedCampaignStrategies(
  client: SupabaseClient,
  input: unknown,
  provider: StrategyProvider,
  now: () => string = () => new Date().toISOString(),
): Promise<StrategyResult> {
  return generateCampaignStrategies(input, { provider, now,
    loadContext: (scope) => loadOwnedPreorderContext(client, scope, now) });
}
