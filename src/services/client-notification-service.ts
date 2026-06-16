import { Input, Telegraf } from "telegraf";
import fs from "node:fs";
import path from "node:path";
import { Logger } from "../utils/logger.js";
import { htmlToPlainText } from "./html-to-plain-text.js";
import { getTracer, setSpanAttributes, withSpan } from "../utils/telemetry.js";

const notificationTracer = getTracer("notification");

export type BusinessAutomationReplyInput = {
  businessConnectionId: string;
  chatId: string;
  html: string;
  replyToMessageId?: number;
};

export class ClientNotificationService {
  private bot?: Telegraf;

  constructor(private readonly logger: Logger) {}

  attachBot(bot: Telegraf): void {
    this.bot = bot;
  }

  async sendToClient(clientUserId: string, text: string): Promise<boolean> {
    return withSpan(
      notificationTracer,
      "notification.send",
      async (span) => {
        setSpanAttributes(span, {
          "telegram.client_user_id": clientUserId,
          "notification.kind": "text"
        });
    if (!this.bot) {
      this.logger.warn("client_notification_skipped_bot_unavailable", { clientUserId });
      return false;
    }

    const userId = Number(clientUserId);
    if (!Number.isFinite(userId)) {
      this.logger.warn("client_notification_skipped_invalid_user_id", { clientUserId });
      return false;
    }

    try {
      await this.bot.telegram.sendMessage(userId, text);
      this.logger.info("client_notification_sent", { clientUserId });
      return true;
    } catch (error) {
      this.logger.error("client_notification_failed", { clientUserId, error: String(error) });
      return false;
    }
      }
    );
  }

  async sendHTML(clientUserId: string, html: string): Promise<boolean> {
    return withSpan(
      notificationTracer,
      "notification.send",
      async (span) => {
        setSpanAttributes(span, {
          "telegram.client_user_id": clientUserId,
          "notification.kind": "html"
        });
        if (!this.bot) {
          this.logger.warn("client_notification_skipped_bot_unavailable", { clientUserId });
          return false;
        }

        const userId = Number(clientUserId);
        if (!Number.isFinite(userId)) {
          this.logger.warn("client_notification_skipped_invalid_user_id", { clientUserId });
          return false;
        }

        try {
          await this.bot.telegram.sendMessage(userId, html, { parse_mode: "HTML" });
          this.logger.info("client_notification_sent_html", { clientUserId });
          return true;
        } catch (error) {
          this.logger.warn("client_notification_html_failed_fallback_to_text", {
            clientUserId,
            error: String(error)
          });
          return this.sendToClient(clientUserId, htmlToPlainText(html));
        }
      }
    );
  }

  async sendHTMLWithInlineButton(
    clientUserId: string,
    html: string,
    buttonLabel: string,
    callbackData: string
  ): Promise<boolean> {
    return withSpan(
      notificationTracer,
      "notification.send",
      async (span) => {
        setSpanAttributes(span, {
          "telegram.client_user_id": clientUserId,
          "notification.kind": "html_inline_button"
        });
        if (!this.bot) {
          this.logger.warn("client_notification_skipped_bot_unavailable", { clientUserId });
          return false;
        }

        const userId = Number(clientUserId);
        if (!Number.isFinite(userId)) {
          this.logger.warn("client_notification_skipped_invalid_user_id", { clientUserId });
          return false;
        }

        try {
          await this.bot.telegram.sendMessage(userId, html, {
            parse_mode: "HTML",
            reply_markup: {
              inline_keyboard: [[{ text: buttonLabel, callback_data: callbackData }]]
            }
          });
          this.logger.info("client_notification_sent_html_button", { clientUserId, callbackData });
          return true;
        } catch (error) {
          this.logger.error("client_notification_html_button_failed", {
            clientUserId,
            error: String(error)
          });
          return false;
        }
      }
    );
  }

  /** Reply in the moderated user's private chat via Telegram Business automation (Bot API). */
  async sendBusinessHTMLReply(input: BusinessAutomationReplyInput): Promise<boolean> {
    return withSpan(
      notificationTracer,
      "notification.send",
      async (span) => {
        setSpanAttributes(span, {
          "telegram.chat_id": input.chatId,
          "telegram.transport": "bot_api",
          "notification.kind": "business_html_reply"
        });
        if (!this.bot) {
          this.logger.warn("business_automation_reply_skipped_bot_unavailable", {
            chatId: input.chatId
          });
          return false;
        }

        const chatId = Number(input.chatId);
        if (!Number.isFinite(chatId)) {
          this.logger.warn("business_automation_reply_skipped_invalid_chat_id", {
            chatId: input.chatId
          });
          return false;
        }

        try {
          await this.bot.telegram.callApi("sendMessage", {
            business_connection_id: input.businessConnectionId,
            chat_id: chatId,
            text: input.html,
            parse_mode: "HTML",
            ...(input.replyToMessageId != null && input.replyToMessageId > 0
              ? { reply_parameters: { message_id: input.replyToMessageId } }
              : {})
          } as Parameters<typeof this.bot.telegram.callApi>[1]);
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
      }
    );
  }

  async sendBusinessMediaReply(
    input: BusinessAutomationReplyInput & { mediaPath: string }
  ): Promise<boolean> {
    const ext = path.extname(input.mediaPath).toLowerCase();
    const isVideo = ext === ".mp4" || ext === ".mov" || ext === ".webm";

    return withSpan(
      notificationTracer,
      "notification.send",
      async (span) => {
        setSpanAttributes(span, {
          "telegram.chat_id": input.chatId,
          "telegram.transport": "bot_api",
          "notification.kind": isVideo ? "business_video_reply" : "business_photo_reply",
          "media.path": path.basename(input.mediaPath),
          "media.ext": ext || "unknown"
        });
        try {
          const stat = fs.statSync(input.mediaPath);
          setSpanAttributes(span, { "media.bytes": stat.size });
        } catch {
          // optional attribute
        }

        if (!this.bot) {
          this.logger.warn("business_automation_media_reply_skipped_bot_unavailable", {
            chatId: input.chatId
          });
          return false;
        }

        const chatId = Number(input.chatId);
        if (!Number.isFinite(chatId)) {
          this.logger.warn("business_automation_media_reply_skipped_invalid_chat_id", {
            chatId: input.chatId
          });
          return false;
        }

        const replyParams =
          input.replyToMessageId != null && input.replyToMessageId > 0
            ? { reply_parameters: { message_id: input.replyToMessageId } }
            : {};

        try {
          if (isVideo) {
            await this.bot.telegram.callApi(
              "sendVideo",
              {
                business_connection_id: input.businessConnectionId,
                chat_id: chatId,
                video: Input.fromLocalFile(input.mediaPath),
                caption: input.html,
                parse_mode: "HTML",
                ...replyParams
              } as Parameters<typeof this.bot.telegram.callApi>[1]
            );
          } else {
            await this.bot.telegram.callApi(
              "sendPhoto",
              {
                business_connection_id: input.businessConnectionId,
                chat_id: chatId,
                photo: Input.fromLocalFile(input.mediaPath),
                caption: input.html,
                parse_mode: "HTML",
                ...replyParams
              } as Parameters<typeof this.bot.telegram.callApi>[1]
            );
          }
          this.logger.info("business_automation_media_reply_sent", {
            chatId: input.chatId,
            mediaPath: input.mediaPath,
            replyToMessageId: input.replyToMessageId
          });
          return true;
        } catch (error) {
          this.logger.error("business_automation_media_reply_failed", {
            chatId: input.chatId,
            mediaPath: input.mediaPath,
            error: String(error)
          });
          return this.sendBusinessHTMLReply(input);
        }
      }
    );
  }

  async sendHTMLFile(clientUserId: string, filePath: string): Promise<boolean> {
    try {
      const html = fs.readFileSync(filePath, "utf8");
      return await this.sendHTML(clientUserId, html);
    } catch (error) {
      this.logger.error("client_notification_html_file_failed", {
        clientUserId,
        filePath,
        error: String(error)
      });
      return false;
    }
  }
}
