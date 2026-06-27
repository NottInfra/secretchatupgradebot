import type { ModerationDeps } from "./deps.js";
import { BlockTierHandler } from "./block-tier-handler.js";
import { ModerationSkipEvaluator } from "./moderation-skip-evaluator.js";
import { PriorBlockSkipHandler } from "./prior-block-skip-handler.js";
import { SendPriorBlockOwnerPromptUseCase } from "./send-prior-block-owner-prompt.js";
import { WarningTierHandler } from "./warning-tier-handler.js";

export type ModerationHandlers = {
  priorBlockOwnerPrompt: SendPriorBlockOwnerPromptUseCase;
  warningTier: WarningTierHandler;
  blockTier: BlockTierHandler;
  skipEvaluator: ModerationSkipEvaluator;
  priorBlockSkip: PriorBlockSkipHandler;
};

export function createModerationHandlers(deps: ModerationDeps): ModerationHandlers {
  const priorBlockOwnerPrompt = new SendPriorBlockOwnerPromptUseCase(
    deps.pendingBlockOffers,
    deps.notifications,
    deps.analytics,
    deps.logger
  );

  const warningTier = new WarningTierHandler(
    deps.actionLogs,
    deps.moderationReply,
    priorBlockOwnerPrompt,
    deps.analytics,
    deps.logger,
    deps.messageInstanceCollapseSeconds
  );

  const blockTier = new BlockTierHandler(
    deps.actionLogs,
    deps.actionQueue,
    deps.blockOnboarding,
    deps.moderationReply,
    warningTier,
    deps.experiments,
    deps.notifications,
    deps.analytics,
    deps.logger
  );

  return {
    priorBlockOwnerPrompt,
    warningTier,
    blockTier,
    skipEvaluator: new ModerationSkipEvaluator(deps.inboundDedupe, deps.analytics, deps.logger),
    priorBlockSkip: new PriorBlockSkipHandler(deps.actionLogs, deps.analytics, deps.logger)
  };
}
