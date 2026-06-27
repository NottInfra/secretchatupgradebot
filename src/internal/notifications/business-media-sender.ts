import { Input, type Telegraf } from "telegraf";
import type { Logger } from "../lib/logger.js";
import type { BusinessAutomationReplyInput } from "../lib/types/index.js";

type MediaReplyInput = BusinessAutomationReplyInput & { mediaPath: string };

export async function sendBusinessMediaMessage(
  bot: Telegraf,
  input: MediaReplyInput,
  chatId: number,
  isVideo: boolean,
  logger: Logger
): Promise<boolean> {
  const replyParams =
    input.replyToMessageId != null && input.replyToMessageId > 0
      ? { reply_parameters: { message_id: input.replyToMessageId } }
      : {};
  const captionParams =
    input.html != null && input.html.trim().length > 0
      ? { caption: input.html, parse_mode: "HTML" as const }
      : {};

  const payload = {
    business_connection_id: input.businessConnectionId,
    chat_id: chatId,
    ...captionParams,
    ...replyParams
  };

  if (isVideo) {
    await bot.telegram.callApi("sendVideo", {
      ...payload,
      video: Input.fromLocalFile(input.mediaPath)
    } as Parameters<typeof bot.telegram.callApi>[1]);
  } else {
    await bot.telegram.callApi("sendPhoto", {
      ...payload,
      photo: Input.fromLocalFile(input.mediaPath)
    } as Parameters<typeof bot.telegram.callApi>[1]);
  }

  logger.info("business_automation_media_reply_sent", {
    chatId: input.chatId,
    mediaPath: input.mediaPath,
    replyToMessageId: input.replyToMessageId
  });
  return true;
}
