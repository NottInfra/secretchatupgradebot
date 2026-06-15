import type { Assignment } from "../services/experiment-service.js";
import type { PendingBlockOfferStore } from "../services/pending-block-offer-store.js";
import type { ClientNotificationService } from "../services/client-notification-service.js";
import type { IncomingMessage } from "../types.js";
import type { Analytics } from "../utils/analytics.js";
import type { Logger } from "../utils/logger.js";
import { getTracer, setSpanAttributes, withSpan } from "../utils/telemetry.js";

const moderationTracer = getTracer("moderation");

export class SendPriorBlockOwnerPromptUseCase {
  constructor(
    private readonly offers: PendingBlockOfferStore,
    private readonly notifications: ClientNotificationService,
    private readonly analytics: Analytics,
    private readonly logger: Logger
  ) {}

  async execute(message: IncomingMessage, tierAssignment: Assignment): Promise<void> {
    return withSpan(
      moderationTracer,
      "moderation.prior_block_prompt",
      async (span) => {
        setSpanAttributes(span, {
          "telegram.session_id": message.sessionId,
          "telegram.sender_id": message.senderId,
          "telegram.chat_id": message.chatId
        });

        const senderRef = message.senderUsername?.trim()
          ? `@${message.senderUsername.trim()}`
          : `user ID ${message.senderId}`;

        const token = this.offers.create(
          message,
          tierAssignment.experimentId,
          tierAssignment.variantId
        );

        const html =
          "<b>This sender was blocked on another account</b>\n\n" +
          `${senderRef} messaged you. They were blocked by another moderated account before.\n\n` +
          "We sent them the usual first warning. Tap below to block them on <b>your</b> account now.";

        const sent = await this.notifications.sendHTMLWithInlineButton(
          message.sessionId,
          html,
          "Block now",
          `owner_block:${token}`
        );

        if (sent) {
          this.analytics.trackEvent("prior_block_owner_prompt_sent", {
            ownerUserId: message.sessionId,
            senderId: message.senderId,
            chatId: message.chatId
          });
          this.logger.info("prior_block_owner_prompt_sent", {
            ownerUserId: message.sessionId,
            senderId: message.senderId,
            chatId: message.chatId
          });
        }
      }
    );
  }
}
