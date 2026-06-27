export type { ModerationDeps } from "./deps.js";
import type { ModerationDeps } from "./deps.js";
import { createModerationHandlers } from "./handlers.js";
import { ProcessIncomingMessageUseCase } from "./process-incoming-message.js";

export type ModerationContainer = {
  processIncomingMessage: ProcessIncomingMessageUseCase;
  priorBlockOwnerPrompt: ReturnType<typeof createModerationHandlers>["priorBlockOwnerPrompt"];
};

export function createModerationContainer(deps: ModerationDeps): ModerationContainer {
  const handlers = createModerationHandlers(deps);

  const processIncomingMessage = new ProcessIncomingMessageUseCase(
    deps.messages,
    handlers.skipEvaluator,
    handlers.priorBlockSkip,
    deps.actionLogs,
    deps.experiments,
    handlers.warningTier,
    handlers.blockTier,
    deps.analytics,
    deps.logger,
    deps.messageInstanceCollapseSeconds
  );

  return { processIncomingMessage, priorBlockOwnerPrompt: handlers.priorBlockOwnerPrompt };
}
