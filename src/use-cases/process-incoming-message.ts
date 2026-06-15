import { ActionLogRepository } from "../repositories/action-log-repository.js";
import { MessageRepository } from "../repositories/message-repository.js";
import { InboundMessageDedupe } from "../services/inbound-message-dedupe.js";
import { ClientNotificationService } from "../services/client-notification-service.js";
import { ExperimentService, type Assignment } from "../services/experiment-service.js";
import { IncomingMessage, ModerationDecision } from "../types.js";
import { Analytics } from "../utils/analytics.js";
import { Logger } from "../utils/logger.js";
import { resolveOutboundPeer } from "../services/telegram/resolve-outbound-peer.js";
import type { TelegramClient } from "telegram";
import type { MtprotoSessionService } from "../bg-services/mtproto-session-service.js";
import { ActionQueueService } from "../bg-services/action-queue-service.js";
import { ExecuteModerationActionUseCase } from "./execute-moderation-action.js";
import { getTracer, setSpanAttributes, withSpan } from "../utils/telemetry.js";
import type { Span } from "@opentelemetry/api";

const moderationTracer = getTracer("moderation");

const LEVEL1_WARNING_EXPERIMENT_ID = "level1_message_warning";
const LEVEL2_WARNING_FINAL_EXPERIMENT_ID = "level2_message_warning_final";
const LEVEL3_BLOCK_EXPERIMENT_ID = "level3_messages_block";

export class ProcessIncomingMessageUseCase {
  private readonly sessionUsernameByClient = new WeakMap<TelegramClient, string>();

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
    private readonly mtprotoSessions: MtprotoSessionService
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

    await this.messages.save(message);
    if (await this.actions.hasPriorBlock(message.senderId, message.chatId)) {
      const decision: ModerationDecision = {
        action: "ignore",
        confidence: 1,
        reason: "prior_block_in_chat_skip"
      };
      this.actions.saveDeferred({
        senderId: message.senderId,
        chatId: message.chatId,
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
        chatId: message.chatId
      });
      return;
    }

    const count = await withSpan(moderationTracer, "moderation.load_history", async () =>
      this.messages.countBySender(message.senderId)
    );

    const tier: "first_warning" | "second_warning" | "block" =
      count === 1 ? "first_warning" : count === 2 ? "second_warning" : "block";

    const tierAssignment = await withSpan(moderationTracer, "moderation.assign_tier", async (tierSpan) => {
      setSpanAttributes(tierSpan, { "moderation.tier": tier });
      return tier === "first_warning"
        ? this.experiments.assignModerationTier(LEVEL1_WARNING_EXPERIMENT_ID, message.senderId)
        : tier === "second_warning"
          ? this.experiments.assignModerationTier(LEVEL2_WARNING_FINAL_EXPERIMENT_ID, message.senderId)
          : this.experiments.assignModerationTier(LEVEL3_BLOCK_EXPERIMENT_ID, message.senderId);
    });

    const decision: ModerationDecision =
      tier === "block"
        ? { action: "block", confidence: 1, reason: "third_or_later_message_auto_block" }
        : tier === "second_warning"
          ? { action: "allow", confidence: 1, reason: "second_message_warning_sent" }
          : { action: "allow", confidence: 1, reason: "first_message_reply_sent" };

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

    if (tier === "first_warning" || tier === "second_warning") {
      const replyHtml = await this.buildReplyHtml(message, tierAssignment);
      await withSpan(moderationTracer, "moderation.send_reply", async () =>
        this.sendFirstMessageReply(message, replyHtml, tierAssignment.mediaPath)
      );
      this.actions.saveDeferred({
        senderId: message.senderId,
        chatId: message.chatId,
        decision
      });
      const eventName =
        tier === "first_warning" ? "first_message_reply_sent" : "second_message_warning_sent";
      this.analytics.trackEvent(eventName, {
        senderId: message.senderId,
        chatId: message.chatId,
        experiment: tierAssignment.experimentId,
        variant: tierAssignment.variantId,
        hasMedia: Boolean(tierAssignment.mediaPath)
      });
      this.logger.info(eventName, {
        senderId: message.senderId,
        chatId: message.chatId,
        experiment: tierAssignment.experimentId,
        variant: tierAssignment.variantId,
        hasMedia: Boolean(tierAssignment.mediaPath)
      });
      return;
    }

    this.actions.saveDeferred({
      senderId: message.senderId,
      chatId: message.chatId,
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
      const blockMessageHtml = await this.buildReplyHtml(message, tierAssignment);
      const client = await this.mtprotoSessions.getClientForBlock(message.sessionId);
      if (!client) {
        this.logger.error("block_skipped_no_mtproto_session", { sessionId: message.sessionId });
      } else {
        await this.executeModerationAction.execute(client, {
          senderId: message.senderId,
          decision,
          blockMessageHtml,
          moderationIncoming: message
        });
      }
      const senderRef = message.senderUsername?.trim()
        ? `@${this.escapeHtml(message.senderUsername.trim())}`
        : `User ID ${this.escapeHtml(message.senderId)}`;
      const noticeHtml = `We just blocked ${senderRef}. Please unblock them if you'd like any further interaction.`;
      const sentViaBot = await this.notifications.sendHTML(message.sessionId, noticeHtml);
      this.analytics.trackEvent("block_notice_sent", {
        senderId: message.senderId,
        sessionId: message.sessionId,
        sentViaBot,
        experiment: tierAssignment.experimentId,
        variant: tierAssignment.variantId
      });
      if (!sentViaBot && client) {
        await this.sendReply(client, "me", noticeHtml);
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

  private getReplyInputPeer(client: TelegramClient, message: IncomingMessage) {
    return resolveOutboundPeer(client, message, this.logger);
  }

  private async sendReply(client: TelegramClient, chatId: string, html: string): Promise<void> {
    try {
      const entity = await client.getInputEntity(chatId);
      await client.sendMessage(entity, { message: html, parseMode: "html" });
    } catch (error) {
      this.logger.error("failed_to_send_reply", { chatId, error: String(error) });
    }
  }

  private async sendReplyToIncoming(message: IncomingMessage, html: string): Promise<void> {
    if (this.usesBusinessAutomationReply(message)) {
      const sent = await this.notifications.sendBusinessHTMLReply(this.businessReplyInput(message, html));
      if (!sent) {
        this.logger.error("failed_to_send_business_reply", { chatId: message.chatId });
      }
      return;
    }

    const client = await this.mtprotoSessions.getClientForBlock(message.sessionId);
    if (!client) {
      this.logger.error("failed_to_send_reply", {
        chatId: message.chatId,
        error: "mtproto_session_unavailable"
      });
      return;
    }

    try {
      const entity = await this.getReplyInputPeer(client, message);
      await client.sendMessage(entity, { message: html, parseMode: "html" });
    } catch (error) {
      this.logger.error("failed_to_send_reply", { chatId: message.chatId, error: String(error) });
    }
  }

  private async sendFirstMessageReply(
    message: IncomingMessage,
    html: string,
    mediaPath: string | undefined
  ): Promise<void> {
    if (this.usesBusinessAutomationReply(message)) {
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
      return;
    }

    const client = await this.mtprotoSessions.getClientForBlock(message.sessionId);
    if (!client) {
      this.logger.error("failed_to_send_reply", {
        chatId: message.chatId,
        error: "mtproto_session_unavailable"
      });
      return;
    }

    if (!mediaPath) {
      await this.sendReplyToIncoming(message, html);
      return;
    }
    try {
      const entity = await this.getReplyInputPeer(client, message);
      await client.sendFile(entity, {
        file: mediaPath,
        caption: html,
        parseMode: "html"
      });
    } catch (error) {
      this.logger.error("failed_to_send_media_reply", {
        chatId: message.chatId,
        mediaPath,
        error: String(error)
      });
      await this.sendReplyToIncoming(message, html);
    }
  }

  private async buildReplyHtml(message: IncomingMessage, assignment: Assignment): Promise<string> {
    return this.substituteSessionUsernameHtml(message, assignment.html);
  }

  private async substituteSessionUsernameHtml(message: IncomingMessage, html: string): Promise<string> {
    const sessionUsername = await this.getSessionUsernameLabel(message);
    return html.replaceAll("{{SESSION_USERNAME}}", this.escapeHtml(sessionUsername));
  }

  private async getSessionUsernameLabel(message: IncomingMessage): Promise<string> {
    const ownerUsername = message.sessionOwnerUsername?.trim();
    if (ownerUsername) {
      return `@${ownerUsername}`;
    }

    if (this.usesBusinessAutomationReply(message)) {
      return "This account";
    }

    const client = await this.mtprotoSessions.getClientForBlock(message.sessionId);
    if (!client) return "This account";

    const cached = this.sessionUsernameByClient.get(client);
    if (cached) return cached;

    try {
      const me = await client.getMe();
      const label =
        typeof (me as { username?: unknown }).username === "string" && (me as { username?: string }).username
          ? `@${(me as { username: string }).username}`
          : "This account";
      this.sessionUsernameByClient.set(client, label);
      return label;
    } catch (error) {
      this.logger.warn("template_username_fallback", { error: String(error) });
      const fallback = "This account";
      this.sessionUsernameByClient.set(client, fallback);
      return fallback;
    }
  }

  private escapeHtml(input: string): string {
    return input
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }
}
