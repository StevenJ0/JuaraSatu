export { generateCampaignStrategies, revalidateStrategyProposal } from "./strategy-service";
export {
  DiscussionInputSchema, DiscussionMessageSchema, GeminiReplySchema,
  StrategyAlternativeSchema, StrategyProposalSchema, StrategyChannelSchema, StrategySourceSchema,
} from "./contracts";
export type { DiscussionRepository, DiscussionScope, DiscussionSession, RepositoryResult, RepositoryError, TurnClaim } from "./discussion-repository";
export type {
  DiscussionInput, DiscussionMessage, GeminiReply, StrategyAlternative, StrategyProposal,
  StrategyProvider, StrategyProviderResult, StrategyPrompt, StrategyDependencies, StrategyResult,
} from "./contracts";
