import type { IClientNotifications } from "../notifications/ports/client-notifications.port.js";
import type { Assignment } from "./experiments/experiment-service.port.js";
import type { IncomingMessage } from "../lib/types/index.js";
import { formatSenderRefHtml } from "../lib/telegram/format-sender-ref.js";
import type { Logger } from "../lib/logger.js";

export class ModerationReplyService {
  constructor(
    private readonly notifications: IClientNotifications,
    private readonly logger: Logger
  ) {}

  buildReplyHtml(message: IncomingMessage, assignment: Assignment, messageCount: number): string {
    const sessionUsername = this.escapeHtml(this.getSessionUsernameLabel(message));
    const senderRef = formatSenderRefHtml(message.senderId, message.senderUsername);
    return assignment.html
      .replaceAll("{{SESSION_USERNAME}}", sessionUsername)
      .replaceAll("{{SVC_USERNAME}}", sessionUsername)
      .replaceAll("{{SENDER_USERNAME}}", senderRef)
      .replaceAll("{{X_WARNING_NUMBER}}", String(messageCount));
  }

  async sendFirstMessageReply(
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
      await this.sendReplyToIncoming(message, html);
      const sent = await this.notifications.sendBusinessMediaReply({
        businessConnectionId: message.businessConnectionId!,
        chatId: message.chatId,
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

  private usesBusinessAutomationReply(message: IncomingMessage): boolean {
    return message.source === "bot_api_automation" && Boolean(message.businessConnectionId);
  }

  private async sendReplyToIncoming(message: IncomingMessage, html: string): Promise<void> {
    const sent = await this.notifications.sendBusinessHTMLReply({
      businessConnectionId: message.businessConnectionId!,
      chatId: message.chatId,
      html,
      replyToMessageId: message.telegramMessageId
    });
    if (!sent) {
      this.logger.error("failed_to_send_business_reply", { chatId: message.chatId });
    }
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
