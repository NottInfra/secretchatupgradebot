import { ActionLogRepository } from "../repositories/action-log-repository.js";
import { MessageRepository } from "../repositories/message-repository.js";
import { InboundMessageDedupe } from "../services/inbound-message-dedupe.js";
import { ClientNotificationService } from "../services/client-notification-service.js";
import { ExperimentService, type Assignment } from "../services/experiment-service.js";
import type { IncomingMessage, ModerationDecision } from "../types.js";
import { decisionForTier, moderationTierForCount, type ModerationTier } from "../services/moderation-tier.js";
import { Analytics } from "../utils/analytics.js";
import { Logger } from "../utils/logger.js";
import { formatSenderRefHtml } from "../services/telegram/format-sender-ref.js";
import { ActionQueueService } from "../bg-services/action-queue-service.js";
import { ExecuteModerationActionUseCase } from "./execute-moderation-action.js";
import { SendPriorBlockOwnerPromptUseCase } from "./send-prior-block-owner-prompt.js";
import type { BlockOnboardingCoordinator } from "../services/session-provider/block-onboarding-coordinator.js";
import { getTracer, setSpanAttributes, withSpan } from "../utils/telemetry.js";
import type { Span } from "@opentelemetry/api";

const moderationTracer = getTracer("moderation");

const LEVEL1_WARNING_EXPERIMENT_ID = "level1_message_warning";
const LEVEL3_BLOCK_EXPERIMENT_ID = "level3_messages_block";

export class ProcessIncomingMessageUseCase {
  constructor(
    private readonly messages: MessageRepository,
    private readonly dedupe: InboundMessageDedupe,
    private readonly actions: ActionLogRepository,
    private readonly executeModerationAction: ExecuteModerationActionUseCase,
    private readonly actionQueue: ActionQueueService,
    private readonly analytics: Analytics,
    private readonly logger: Logger,
    private readonly notifications: ClientNotificationService,
    private readonly experiments: ExperimentService,
    private readonly blockOnboarding: BlockOnboardingCoordinator,
    private readonly priorBlockOwnerPrompt: SendPriorBlockOwnerPromptUseCase,
    private readonly messageInstanceCollapseSeconds: number
  ) {}

  async execute(message: IncomingMessage): Promise<void> {
    return withSpan(
      moderationTracer,
      "moderation.process_incoming",
      async (span) => this.executeModeration(message, span),
      {
        "telegram.chat_id": message.chatId,
        "telegram.sender_id": message.senderId,
        "telegram.message_id": message.telegramMessageId,
        "telegram.source": message.source ?? "unknown"
      }
    );
  }

  private async executeModeration(message: IncomingMessage, span: Span): Promise<void> {
    if (message.senderIsBot === true) {
      this.analytics.trackEvent("moderation_skipped_bot_sender", {
        senderId: message.senderId,
        chatId: message.chatId,
        source: message.source ?? "unknown"
      });
      this.logger.info("moderation_skipped_bot_sender", {
        senderId: message.senderId,
        chatId: message.chatId,
        source: message.source ?? "unknown"
      });
      return;
    }

    if (message.source === "bot_api_automation" && message.senderId === message.sessionId) {
      this.analytics.trackEvent("moderation_skipped_owner_outbound", {
        senderId: message.senderId,
        chatId: message.chatId,
        sessionId: message.sessionId
      });
      this.logger.info("moderation_skipped_owner_outbound", {
        senderId: message.senderId,
        chatId: message.chatId,
        sessionId: message.sessionId
      });
      return;
    }

    const msgId = message.telegramMessageId;
    if (msgId != null && msgId > 0) {
      const claimed = await withSpan(moderationTracer, "moderation.dedupe", async () =>
        this.dedupe.tryClaim(message.chatId, msgId)
      );
      if (!claimed) {
        this.analytics.trackEvent("moderation_duplicate_inbound_skipped", {
          senderId: message.senderId,
          chatId: message.chatId,
          messageId: msgId,
          source: message.source ?? "unknown"
        });
        this.logger.info("moderation_duplicate_inbound_skipped", {
          senderId: message.senderId,
          chatId: message.chatId,
          messageId: msgId,
          source: message.source ?? "unknown"
        });
        return;
      }
    }

    const incomingMessageId = await this.messages.save(message);
    if (await this.actions.hasPriorBlockInSession(message.senderId, message.sessionId)) {
      const decision: ModerationDecision = {
        action: "ignore",
        confidence: 1,
        reason: "prior_block_in_session_skip"
      };
      this.actions.saveDeferred({
        incomingMessageId,
        decision
      });
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
      return;
    }

    const priorBlockOtherAccount = await this.actions.hasPriorBlockByOtherSession(
      message.senderId,
      message.sessionId
    );

    const messageCount = await withSpan(moderationTracer, "moderation.load_history", async () =>
      this.messages.countBySender(message.senderId, message.sessionId)
    );
    const instanceCount = await this.messages.countInstancesBySender(
      message.senderId,
      message.sessionId,
      this.messageInstanceCollapseSeconds
    );

    const tier = moderationTierForCount(instanceCount);

    this.logger.info("moderation_tier_selected", {
      senderId: message.senderId,
      sessionId: message.sessionId,
      messageCount,
      instanceCount,
      collapseWindowSeconds: this.messageInstanceCollapseSeconds,
      tier,
      priorBlockOtherAccount
    });

    const tierAssignment = await withSpan(moderationTracer, "moderation.assign_tier", async (tierSpan) => {
      setSpanAttributes(tierSpan, { "moderation.tier": tier });
      return this.assignTierExperiment(tier, message.senderId);
    });

    const decision = decisionForTier(tier);

    setSpanAttributes(span, {
      "moderation.tier": tier,
      "moderation.action": decision.action,
      experiment: tierAssignment.experimentId,
      variant: tierAssignment.variantId
    });

    this.analytics.trackEvent("moderation_decision", {
      senderId: message.senderId,
      chatId: message.chatId,
      action: decision.action,
      confidence: decision.confidence,
      experiment: tierAssignment.experimentId,
      variant: tierAssignment.variantId,
      tier
    });

    if (tier === "warning") {
      await this.handleWarningTier(
        message,
        incomingMessageId,
        messageCount,
        decision,
        tierAssignment,
        priorBlockOtherAccount
      );
      return;
    }

    await this.queueBlockAction(message, incomingMessageId, messageCount, decision, tierAssignment);
  }

  private assignTierExperiment(tier: ModerationTier, senderId: string) {
    if (tier === "warning") {
      return this.experiments.assignModerationTier(LEVEL1_WARNING_EXPERIMENT_ID, senderId);
    }
    return this.experiments.assignModerationTier(LEVEL3_BLOCK_EXPERIMENT_ID, senderId);
  }

  private async handleWarningTier(
    message: IncomingMessage,
    incomingMessageId: number,
    messageCount: number,
    decision: ModerationDecision,
    tierAssignment: Assignment,
    priorBlockOtherAccount: boolean
  ): Promise<void> {
    const replyHtml = await this.buildReplyHtml(message, tierAssignment, messageCount);
    await withSpan(moderationTracer, "moderation.send_reply", async () =>
      this.sendFirstMessageReply(message, replyHtml, tierAssignment.mediaPath)
    );
    this.actions.saveDeferred({
      incomingMessageId,
      decision
    });
    this.analytics.trackEvent("message_warning_sent", {
      senderId: message.senderId,
      chatId: message.chatId,
      experiment: tierAssignment.experimentId,
      variant: tierAssignment.variantId,
      hasMedia: Boolean(tierAssignment.mediaPath)
    });
    this.logger.info("message_warning_sent", {
      senderId: message.senderId,
      chatId: message.chatId,
      experiment: tierAssignment.experimentId,
      variant: tierAssignment.variantId,
      hasMedia: Boolean(tierAssignment.mediaPath)
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

  private async queueBlockAction(
    message: IncomingMessage,
    incomingMessageId: number,
    messageCount: number,
    decision: ModerationDecision,
    tierAssignment: Assignment
  ): Promise<void> {
    this.actions.saveDeferred({
      incomingMessageId,
      decision
    });

    await withSpan(moderationTracer, "moderation.queue_block", async () => {
      this.actionQueue.enqueue(async () => {
        this.analytics.trackEvent("sender_block_queued", {
          senderId: message.senderId,
          chatId: message.chatId,
          experiment: tierAssignment.experimentId,
          variant: tierAssignment.variantId
        });
        const blockMessageHtml = await this.buildReplyHtml(message, tierAssignment, messageCount);
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
          const noticeHtml = `We just blocked ${senderRef}. Please unblock them if you'd like any further interaction.`;
          const sentViaBot = await this.notifications.sendHTML(message.sessionId, noticeHtml);
          this.analytics.trackEvent("block_notice_sent", {
            senderId: message.senderId,
            sessionId: message.sessionId,
            sentViaBot,
            experiment: tierAssignment.experimentId,
            variant: tierAssignment.variantId
          });
        } else {
          this.logger.info("block_deferred_for_onboarding", { sessionId: message.sessionId });
        }
      });
    });

    this.logger.info("sender_queued_for_block", {
      senderId: message.senderId,
      chatId: message.chatId,
      experiment: tierAssignment.experimentId,
      variant: tierAssignment.variantId
    });
  }

  private usesBusinessAutomationReply(message: IncomingMessage): boolean {
    return message.source === "bot_api_automation" && Boolean(message.businessConnectionId);
  }

  private businessReplyInput(message: IncomingMessage, html: string) {
    return {
      businessConnectionId: message.businessConnectionId!,
      chatId: message.chatId,
      html,
      replyToMessageId: message.telegramMessageId
    };
  }

  private async sendReplyToIncoming(message: IncomingMessage, html: string): Promise<void> {
    if (!this.usesBusinessAutomationReply(message)) {
      this.logger.error("failed_to_send_reply", {
        chatId: message.chatId,
        error: "business_automation_required"
      });
      return;
    }

    const sent = await this.notifications.sendBusinessHTMLReply(this.businessReplyInput(message, html));
    if (!sent) {
      this.logger.error("failed_to_send_business_reply", { chatId: message.chatId });
    }
  }

  private async sendFirstMessageReply(
    message: IncomingMessage,
    html: string,
    mediaPath: string | undefined
  ): Promise<void> {
    if (!this.usesBusinessAutomationReply(message)) {
      this.logger.error("failed_to_send_reply", {
        chatId: message.chatId,
        error: "business_automation_required"
      });
      return;
    }

    if (mediaPath) {
      const sent = await this.notifications.sendBusinessMediaReply({
        ...this.businessReplyInput(message, html),
        mediaPath
      });
      if (!sent) {
        this.logger.error("failed_to_send_business_media_reply", {
          chatId: message.chatId,
          mediaPath
        });
      }
      return;
    }

    await this.sendReplyToIncoming(message, html);
  }

  private async buildReplyHtml(
    message: IncomingMessage,
    assignment: Assignment,
    messageCount: number
  ): Promise<string> {
    const sessionUsername = this.escapeHtml(this.getSessionUsernameLabel(message));
    const senderRef = formatSenderRefHtml(message.senderId, message.senderUsername);
    return assignment.html
      .replaceAll("{{SESSION_USERNAME}}", sessionUsername)
      .replaceAll("{{SVC_USERNAME}}", sessionUsername)
      .replaceAll("{{SENDER_USERNAME}}", senderRef)
      .replaceAll("{{X_WARNING_NUMBER}}", String(messageCount));
  }

  private getSessionUsernameLabel(message: IncomingMessage): string {
    const ownerUsername = message.sessionOwnerUsername?.trim();
    if (ownerUsername) {
      return `@${ownerUsername}`;
    }
    return "This account";
  }

  private escapeHtml(input: string): string {
    return input
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }
}
