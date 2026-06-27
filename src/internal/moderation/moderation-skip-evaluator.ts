import type { IncomingMessage } from "../lib/types/index.js";
import type { Analytics } from "../lib/analytics.js";
import type { Logger } from "../lib/logger.js";
import type { IInboundMessageDedupe } from "./ports/inbound-message-dedupe.port.js";

export type ModerationSkipResult = { skip: false } | { skip: true };

function skipBotSender(message: IncomingMessage, analytics: Analytics, logger: Logger): ModerationSkipResult {
  analytics.trackEvent("moderation_skipped_bot_sender", {
    senderId: message.senderId,
    chatId: message.chatId,
    source: message.source ?? "unknown"
  });
  logger.info("moderation_skipped_bot_sender", {
    senderId: message.senderId,
    chatId: message.chatId,
    source: message.source ?? "unknown"
  });
  return { skip: true };
}

function skipOwnerOutbound(message: IncomingMessage, analytics: Analytics, logger: Logger): ModerationSkipResult {
  analytics.trackEvent("moderation_skipped_owner_outbound", {
    senderId: message.senderId,
    chatId: message.chatId,
    sessionId: message.sessionId
  });
  logger.info("moderation_skipped_owner_outbound", {
    senderId: message.senderId,
    chatId: message.chatId,
    sessionId: message.sessionId
  });
  return { skip: true };
}

function skipDuplicate(
  message: IncomingMessage,
  msgId: number,
  analytics: Analytics,
  logger: Logger
): ModerationSkipResult {
  analytics.trackEvent("moderation_duplicate_inbound_skipped", {
    senderId: message.senderId,
    chatId: message.chatId,
    messageId: msgId,
    source: message.source ?? "unknown"
  });
  logger.info("moderation_duplicate_inbound_skipped", {
    senderId: message.senderId,
    chatId: message.chatId,
    messageId: msgId,
    source: message.source ?? "unknown"
  });
  return { skip: true };
}

export class ModerationSkipEvaluator {
  constructor(
    private readonly dedupe: IInboundMessageDedupe,
    private readonly analytics: Analytics,
    private readonly logger: Logger
  ) {}

  async evaluate(message: IncomingMessage): Promise<ModerationSkipResult> {
    if (message.senderIsBot === true) {
      return skipBotSender(message, this.analytics, this.logger);
    }

    if (message.source === "bot_api_automation" && message.senderId === message.sessionId) {
      return skipOwnerOutbound(message, this.analytics, this.logger);
    }

    const msgId = message.telegramMessageId;
    if (msgId != null && msgId > 0) {
      const claimed = await this.dedupe.tryClaim(message.chatId, msgId);
      if (!claimed) {
        return skipDuplicate(message, msgId, this.analytics, this.logger);
      }
    }

    return { skip: false };
  }
}
