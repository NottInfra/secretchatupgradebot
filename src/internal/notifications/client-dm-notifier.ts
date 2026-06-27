import type { Telegraf } from "telegraf";
import type { Logger } from "../lib/logger.js";
import { htmlToPlainText } from "../lib/telegram/html-to-plain-text/index.js";
import { getTracer, setSpanAttributes, withSpan } from "../lib/telemetry.js";
import { resolveBotSendContext } from "./bot-context.js";

const notificationTracer = getTracer("notification");

export class ClientDmNotifier {
  constructor(
    private readonly getBot: () => Telegraf | undefined,
    private readonly logger: Logger
  ) {}

  async sendToClient(clientUserId: string, text: string): Promise<boolean> {
    return withSpan(notificationTracer, "notification.send", async (span) => {
      setSpanAttributes(span, {
        "telegram.client_user_id": clientUserId,
        "notification.kind": "text"
      });
      const ctx = resolveBotSendContext(this.getBot(), clientUserId, this.logger);
      if (!ctx) return false;

      try {
        await ctx.bot.telegram.sendMessage(ctx.userId, text);
        this.logger.info("client_notification_sent", { clientUserId });
        return true;
      } catch (error) {
        this.logger.error("client_notification_failed", { clientUserId, error: String(error) });
        return false;
      }
    });
  }

  async sendHTML(clientUserId: string, html: string): Promise<boolean> {
    return withSpan(notificationTracer, "notification.send", async (span) => {
      setSpanAttributes(span, {
        "telegram.client_user_id": clientUserId,
        "notification.kind": "html"
      });
      const ctx = resolveBotSendContext(this.getBot(), clientUserId, this.logger);
      if (!ctx) return false;

      try {
        await ctx.bot.telegram.sendMessage(ctx.userId, html, { parse_mode: "HTML" });
        this.logger.info("client_notification_sent_html", { clientUserId });
        return true;
      } catch (error) {
        this.logger.warn("client_notification_html_failed_fallback_to_text", {
          clientUserId,
          error: String(error)
        });
        return this.sendToClient(clientUserId, htmlToPlainText(html));
      }
    });
  }

  async sendHTMLWithInlineButton(
    clientUserId: string,
    html: string,
    buttonLabel: string,
    callbackData: string
  ): Promise<boolean> {
    return withSpan(notificationTracer, "notification.send", async (span) => {
      setSpanAttributes(span, {
        "telegram.client_user_id": clientUserId,
        "notification.kind": "html_inline_button"
      });
      const ctx = resolveBotSendContext(this.getBot(), clientUserId, this.logger);
      if (!ctx) return false;

      try {
        await ctx.bot.telegram.sendMessage(ctx.userId, html, {
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
    });
  }
}
