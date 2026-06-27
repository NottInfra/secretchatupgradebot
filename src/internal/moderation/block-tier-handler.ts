import type { IActionLogRepository } from "./ports/action-log-repository.port.js";
import type { ActionQueueService } from "./action-queue-service.js";
import type { Assignment, IExperimentService } from "./experiments/experiment-service.port.js";
import type { IClientNotifications } from "../notifications/ports/client-notifications.port.js";
import type { IModerationReply } from "./ports/moderation-reply.port.js";
import type { IBlockOnboarding } from "../session/ports/block-onboarding.port.js";
import { formatSenderRefHtml } from "../lib/telegram/format-sender-ref.js";
import { decisionForTier } from "./moderation-tier.js";
import type { IncomingMessage, ModerationDecision } from "../lib/types/index.js";
import type { Analytics } from "../lib/analytics.js";
import type { Logger } from "../lib/logger.js";
import { getTracer, withSpan } from "../lib/telemetry.js";
import type { WarningTierHandler } from "./warning-tier-handler.js";

const moderationTracer = getTracer("moderation");
const LEVEL1_WARNING_EXPERIMENT_ID = "level1_message_warning";

export class BlockTierHandler {
  constructor(
    private readonly actions: IActionLogRepository,
    private readonly actionQueue: ActionQueueService,
    private readonly blockOnboarding: IBlockOnboarding,
    private readonly reply: IModerationReply,
    private readonly warningTier: WarningTierHandler,
    private readonly experiments: IExperimentService,
    private readonly notifications: IClientNotifications,
    private readonly analytics: Analytics,
    private readonly logger: Logger
  ) {}

  async queue(
    message: IncomingMessage,
    incomingMessageId: number,
    messageCount: number,
    instanceCount: number,
    decision: ModerationDecision,
    tierAssignment: Assignment
  ): Promise<void> {
    await withSpan(moderationTracer, "moderation.queue_block", async () => {
      this.actionQueue.enqueue(() =>
        this.executeQueuedBlock(
          message,
          incomingMessageId,
          messageCount,
          instanceCount,
          decision,
          tierAssignment
        )
      );
    });

    this.logger.info("sender_queued_for_block", {
      senderId: message.senderId,
      chatId: message.chatId,
      experiment: tierAssignment.experimentId,
      variant: tierAssignment.variantId
    });
  }

  private async executeQueuedBlock(
    message: IncomingMessage,
    incomingMessageId: number,
    messageCount: number,
    instanceCount: number,
    decision: ModerationDecision,
    tierAssignment: Assignment
  ): Promise<void> {
    this.analytics.trackEvent("sender_block_queued", {
      senderId: message.senderId,
      chatId: message.chatId,
      experiment: tierAssignment.experimentId,
      variant: tierAssignment.variantId
    });

    const blockMessageHtml = this.reply.buildReplyHtml(message, tierAssignment, messageCount);
    const senderRef = formatSenderRefHtml(message.senderId, message.senderUsername);
    const blocked = await this.blockOnboarding.executeBlockWithSession(
      message.sessionId,
      {
        senderId: message.senderId,
        decision,
        blockMessageHtml,
        moderationIncoming: message
      },
      senderRef
    );

    if (blocked) {
      await this.recordSuccessfulBlock(message, incomingMessageId, decision, tierAssignment, senderRef);
      return;
    }

    await this.fallbackToWarning(message, incomingMessageId, messageCount, instanceCount);
  }

  private async recordSuccessfulBlock(
    message: IncomingMessage,
    incomingMessageId: number,
    decision: ModerationDecision,
    tierAssignment: Assignment,
    senderRef: string
  ): Promise<void> {
    this.actions.saveDeferred({ incomingMessageId, decision });
    const noticeHtml = `We just blocked ${senderRef}. Please unblock them if you'd like any further interaction.`;
    const sentViaBot = await this.notifications.sendHTML(message.sessionId, noticeHtml);
    this.analytics.trackEvent("block_notice_sent", {
      senderId: message.senderId,
      sessionId: message.sessionId,
      sentViaBot,
      experiment: tierAssignment.experimentId,
      variant: tierAssignment.variantId
    });
  }

  private async fallbackToWarning(
    message: IncomingMessage,
    incomingMessageId: number,
    messageCount: number,
    instanceCount: number
  ): Promise<void> {
    this.logger.info("block_failed_sending_warning", {
      senderId: message.senderId,
      sessionId: message.sessionId
    });
    const warningAssignment = this.experiments.assignModerationTier(
      LEVEL1_WARNING_EXPERIMENT_ID,
      message.senderId
    );
    const warnDecision = decisionForTier("warning");
    const priorBlockOtherAccount = await this.actions.hasPriorBlockByOtherSession(
      message.senderId,
      message.sessionId
    );
    await this.warningTier.handle(
      message,
      incomingMessageId,
      messageCount,
      instanceCount,
      warnDecision,
      warningAssignment,
      priorBlockOtherAccount
    );
  }
}
