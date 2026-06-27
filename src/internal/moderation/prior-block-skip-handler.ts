import type { IActionLogRepository } from "./ports/action-log-repository.port.js";
import type { IncomingMessage } from "../lib/types/index.js";
import type { Analytics } from "../lib/analytics.js";
import type { Logger } from "../lib/logger.js";

export class PriorBlockSkipHandler {
  constructor(
    private readonly actions: IActionLogRepository,
    private readonly analytics: Analytics,
    private readonly logger: Logger
  ) {}

  async trySkip(
    message: IncomingMessage,
    incomingMessageId: number
  ): Promise<boolean> {
    if (!(await this.actions.hasPriorBlockInSession(message.senderId, message.sessionId))) {
      return false;
    }

    const decision = {
      action: "ignore" as const,
      confidence: 1,
      reason: "prior_block_in_session_skip"
    };
    this.actions.saveDeferred({ incomingMessageId, decision });
    this.analytics.trackEvent("moderation_decision", {
      senderId: message.senderId,
      chatId: message.chatId,
      action: decision.action,
      confidence: decision.confidence,
      reason: decision.reason,
      tier: "skipped_prior_block"
    });
    this.logger.info("moderation_skipped_prior_block", {
      senderId: message.senderId,
      chatId: message.chatId,
      sessionId: message.sessionId
    });
    return true;
  }
}
