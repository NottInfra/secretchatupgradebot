import type { Telegraf } from "telegraf";
import type { Logger } from "../lib/logger.js";

export type BotSendContext = {
  bot: Telegraf;
  userId: number;
};

export function resolveBotSendContext(
  bot: Telegraf | undefined,
  clientUserId: string,
  logger: Logger
): BotSendContext | undefined {
  if (!bot) {
    logger.warn("client_notification_skipped_bot_unavailable", { clientUserId });
    return undefined;
  }

  const userId = Number(clientUserId);
  if (!Number.isFinite(userId)) {
    logger.warn("client_notification_skipped_invalid_user_id", { clientUserId });
    return undefined;
  }

  return { bot, userId };
}

export function resolveBusinessChatId(
  chatId: string,
  logger: Logger,
  logKey: string
): number | undefined {
  const parsed = Number(chatId);
  if (!Number.isFinite(parsed)) {
    logger.warn(logKey, { chatId });
    return undefined;
  }
  return parsed;
}
