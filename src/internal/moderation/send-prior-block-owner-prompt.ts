import type { Assignment } from "./experiments/experiment-service.port.js";
import type { IPendingBlockOfferStore } from "./ports/pending-block-offer.port.js";
import type { IClientNotifications } from "../notifications/ports/client-notifications.port.js";
import { formatSenderRefHtml } from "../lib/telegram/format-sender-ref.js";
import type { IncomingMessage } from "../lib/types/index.js";
import type { Analytics } from "../lib/analytics.js";
import type { Logger } from "../lib/logger.js";
import { getTracer, setSpanAttributes, withSpan } from "../lib/telemetry.js";

const moderationTracer = getTracer("moderation");

export class SendPriorBlockOwnerPromptUseCase {
  constructor(
    private readonly offers: IPendingBlockOfferStore,
    private readonly notifications: IClientNotifications,
    private readonly analytics: Analytics,
    private readonly logger: Logger
  ) {}

  async execute(
    message: IncomingMessage,
    incomingMessageId: number,
    tierAssignment: Assignment
  ): Promise<void> {
    return withSpan(
      moderationTracer,
      "moderation.prior_block_prompt",
      async (span) => {
        setSpanAttributes(span, {
          "telegram.session_id": message.sessionId,
          "telegram.sender_id": message.senderId,
          "telegram.chat_id": message.chatId
        });

        const senderRef = formatSenderRefHtml(message.senderId, message.senderUsername);

        const token = this.offers.create(
          message,
          incomingMessageId,
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
