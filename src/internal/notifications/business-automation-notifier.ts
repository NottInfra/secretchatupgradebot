import type { Telegraf } from "telegraf";
import type { Span } from "@opentelemetry/api";
import fs from "node:fs";
import path from "node:path";
import type { Logger } from "../lib/logger.js";
import { getTracer, setSpanAttributes, withSpan } from "../lib/telemetry.js";
import { resolveBusinessChatId } from "./bot-context.js";
import { sendBusinessMediaMessage } from "./business-media-sender.js";
import type { BusinessAutomationReplyInput } from "../lib/types/index.js";

const notificationTracer = getTracer("notification");

export class BusinessAutomationNotifier {
  constructor(
    private readonly getBot: () => Telegraf | undefined,
    private readonly logger: Logger
  ) {}

  async sendHTMLReply(input: BusinessAutomationReplyInput): Promise<boolean> {
    return withSpan(notificationTracer, "notification.send", async (span) => {
      setSpanAttributes(span, {
        "telegram.chat_id": input.chatId,
        "telegram.transport": "bot_api",
        "notification.kind": "business_html_reply"
      });
      const bot = this.getBot();
      if (!bot) {
        this.logger.warn("business_automation_reply_skipped_bot_unavailable", { chatId: input.chatId });
        return false;
      }

      const chatId = resolveBusinessChatId(
        input.chatId,
        this.logger,
        "business_automation_reply_skipped_invalid_chat_id"
      );
      if (chatId === undefined) return false;

      try {
        await bot.telegram.callApi("sendMessage", {
          business_connection_id: input.businessConnectionId,
          chat_id: chatId,
          text: input.html,
          parse_mode: "HTML",
          ...(input.replyToMessageId != null && input.replyToMessageId > 0
            ? { reply_parameters: { message_id: input.replyToMessageId } }
            : {})
        } as Parameters<typeof bot.telegram.callApi>[1]);
        this.logger.info("business_automation_reply_sent", {
          chatId: input.chatId,
          replyToMessageId: input.replyToMessageId
        });
        return true;
      } catch (error) {
        this.logger.error("business_automation_reply_failed", {
          chatId: input.chatId,
          error: String(error)
        });
        return false;
      }
    });
  }

  async sendMediaReply(input: BusinessAutomationReplyInput & { mediaPath: string }): Promise<boolean> {
    const ext = path.extname(input.mediaPath).toLowerCase();
    const isVideo = ext === ".mp4" || ext === ".mov" || ext === ".webm";

    return withSpan(notificationTracer, "notification.send", async (span) => {
      setSpanAttributes(span, {
        "telegram.chat_id": input.chatId,
        "telegram.transport": "bot_api",
        "notification.kind": isVideo ? "business_video_reply" : "business_photo_reply",
        "media.path": path.basename(input.mediaPath),
        "media.ext": ext || "unknown"
      });
      this.recordMediaSize(span, input.mediaPath);

      const bot = this.getBot();
      if (!bot) {
        this.logger.warn("business_automation_media_reply_skipped_bot_unavailable", {
          chatId: input.chatId
        });
        return false;
      }

      const chatId = resolveBusinessChatId(
        input.chatId,
        this.logger,
        "business_automation_media_reply_skipped_invalid_chat_id"
      );
      if (chatId === undefined) return false;

      return this.sendMediaWithFallback(bot, input, chatId, isVideo);
    });
  }

  private recordMediaSize(span: Span, mediaPath: string): void {
    try {
      const stat = fs.statSync(mediaPath);
      setSpanAttributes(span, { "media.bytes": stat.size });
    } catch {
      // optional attribute
    }
  }

  private async sendMediaWithFallback(
    bot: Telegraf,
    input: BusinessAutomationReplyInput & { mediaPath: string },
    chatId: number,
    isVideo: boolean
  ): Promise<boolean> {
    try {
      return await sendBusinessMediaMessage(bot, input, chatId, isVideo, this.logger);
    } catch (error) {
      this.logger.error("business_automation_media_reply_failed", {
        chatId: input.chatId,
        mediaPath: input.mediaPath,
        error: String(error)
      });
      if (input.html != null && input.html.trim().length > 0) {
        return this.sendHTMLReply({
          businessConnectionId: input.businessConnectionId,
          chatId: input.chatId,
          html: input.html,
          replyToMessageId: input.replyToMessageId
        });
      }
      return false;
    }
  }
}
