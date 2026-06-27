import type { IActionLogRepository } from "./ports/action-log-repository.port.js";
import type { Assignment } from "./experiments/experiment-service.port.js";
import type { IModerationReply } from "./ports/moderation-reply.port.js";
import type { IncomingMessage, ModerationDecision } from "../lib/types/index.js";
import type { Analytics } from "../lib/analytics.js";
import type { Logger } from "../lib/logger.js";
import { getTracer, withSpan } from "../lib/telemetry.js";
import type { SendPriorBlockOwnerPromptUseCase } from "./send-prior-block-owner-prompt.js";

const moderationTracer = getTracer("moderation");

export class WarningTierHandler {
  constructor(
    private readonly actions: IActionLogRepository,
    private readonly reply: IModerationReply,
    private readonly priorBlockOwnerPrompt: SendPriorBlockOwnerPromptUseCase,
    private readonly analytics: Analytics,
    private readonly logger: Logger,
    private readonly messageInstanceCollapseSeconds: number
  ) {}

  async handle(
    message: IncomingMessage,
    incomingMessageId: number,
    messageCount: number,
    instanceCount: number,
    decision: ModerationDecision,
    tierAssignment: Assignment,
    priorBlockOtherAccount: boolean
  ): Promise<void> {
    const replyHtml = this.reply.buildReplyHtml(message, tierAssignment, messageCount);
    await withSpan(moderationTracer, "moderation.send_reply", async () =>
      this.reply.sendFirstMessageReply(message, replyHtml, tierAssignment.mediaPath)
    );
    this.actions.saveDeferred({ incomingMessageId, decision });
    this.analytics.trackEvent("message_warning_sent", {
      senderId: message.senderId,
      chatId: message.chatId,
      experiment: tierAssignment.experimentId,
      variant: tierAssignment.variantId,
      hasMedia: Boolean(tierAssignment.mediaPath),
      messageCount,
      instanceCount,
      collapseWindowSeconds: this.messageInstanceCollapseSeconds
    });
    this.logger.info("message_warning_sent", {
      senderId: message.senderId,
      chatId: message.chatId,
      experiment: tierAssignment.experimentId,
      variant: tierAssignment.variantId,
      hasMedia: Boolean(tierAssignment.mediaPath),
      messageCount,
      instanceCount
    });

    if (priorBlockOtherAccount) {
      this.analytics.trackEvent("cross_account_prior_block_detected", {
        senderId: message.senderId,
        chatId: message.chatId,
        sessionId: message.sessionId
      });
      await this.priorBlockOwnerPrompt.execute(message, incomingMessageId, tierAssignment);
    }
  }
}
