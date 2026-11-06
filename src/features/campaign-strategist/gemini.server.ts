import "server-only";
import type { GeminiDebugTrace } from "@/lib/ai/gemini-debug.server";
import { createGeminiJsonProvider } from "@/lib/ai/gemini-json.server";
import { GeminiReplySchema, type StrategyProvider } from "./contracts";

export function createGeminiStrategyProvider(configInput: unknown, debug?: GeminiDebugTrace): StrategyProvider {
  return createGeminiJsonProvider(configInput, GeminiReplySchema, debug);
}
