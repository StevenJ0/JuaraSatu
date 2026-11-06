import "server-only";
import type { GeminiDebugTrace } from "@/lib/ai/gemini-debug.server";
import { geminiConfiguration, type GeminiEnvironment } from "@/lib/ai/gemini-json.server";
import { DiscussionHttpError } from "./discussion-auth.server";
import { developmentEnabled, developmentProvider } from "./development-provider";
import { createGeminiStrategyProvider } from "./gemini.server";
import type { DevelopmentScenario } from "./persistence-contracts";

type Environment = Parameters<typeof developmentEnabled>[0] & GeminiEnvironment;
export function discussionProviderIdentity(env: Environment) {
  if (!developmentEnabled(env)) throw new DiscussionHttpError(503, "CONFIGURATION_ERROR");
  if (env.CAMPAIGN_DISCUSSION_PROVIDER === "fake") return { provider: "development-fake", model: "development-fake" };
  try { return { provider: "gemini", model: geminiConfiguration(env).model }; }
  catch { throw new DiscussionHttpError(503, "CONFIGURATION_ERROR"); }
}
export function configuredDiscussionProvider(scenario: DevelopmentScenario, env: Environment, debug?: GeminiDebugTrace) {
  const identity = discussionProviderIdentity(env);
  if (identity.provider === "development-fake") return developmentProvider(scenario, env);
  if (scenario !== "normal") throw new DiscussionHttpError(400, "FAKE_SCENARIO_DISABLED");
  return createGeminiStrategyProvider(geminiConfiguration(env), debug);
}
