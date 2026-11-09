import "server-only";
import { geminiConfiguration } from "@/lib/ai/gemini-json.server";
import { createGeminiStrategyProvider } from "./gemini.server";
import { createGeminiBlueprintProvider } from "../campaign-blueprint/gemini.server";
import { DiscussionHttpError } from "./discussion-auth.server";
const environment = () => ({ GEMINI_API_KEY: process.env.GEMINI_API_KEY, GEMINI_MODEL: process.env.GEMINI_MODEL,
  GEMINI_TIMEOUT_MS: process.env.GEMINI_TIMEOUT_MS, GEMINI_BASE_URL: process.env.GEMINI_BASE_URL });

export function ownerProviderIdentity() {
  try { return { provider: "gemini", model: geminiConfiguration(environment()).model }; }
  catch { return { provider: "gemini-unconfigured", model: "gemini-unconfigured" }; }
}
export function ownerStrategyProvider() {
  try { return createGeminiStrategyProvider(geminiConfiguration(environment(), 2)); }
  catch { throw new DiscussionHttpError(503, "CONFIGURATION_ERROR"); }
}
export function ownerBlueprintProvider() { return createGeminiBlueprintProvider(environment(), 2); }
