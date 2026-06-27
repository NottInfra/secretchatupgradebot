import type { Telegraf } from "telegraf";
import fs from "node:fs";
import type { Logger } from "../lib/logger.js";
import type { IClientNotifications } from "./ports/client-notifications.port.js";
import type { BusinessAutomationReplyInput } from "../lib/types/index.js";
import {
  BusinessAutomationNotifier
} from "./business-automation-notifier.js";
import { ClientDmNotifier } from "./client-dm-notifier.js";

export type { BusinessAutomationReplyInput };

export class ClientNotificationService implements IClientNotifications {
  private bot?: Telegraf;
  private readonly dm: ClientDmNotifier;
  private readonly business: BusinessAutomationNotifier;

  constructor(private readonly logger: Logger) {
    const getBot = () => this.bot;
    this.dm = new ClientDmNotifier(getBot, logger);
    this.business = new BusinessAutomationNotifier(getBot, logger);
  }

  attachBot(bot: Telegraf): void {
    this.bot = bot;
  }

  sendToClient(clientUserId: string, text: string): Promise<boolean> {
    return this.dm.sendToClient(clientUserId, text);
  }

  sendHTML(clientUserId: string, html: string): Promise<boolean> {
    return this.dm.sendHTML(clientUserId, html);
  }

  sendHTMLWithInlineButton(
    clientUserId: string,
    html: string,
    buttonLabel: string,
    callbackData: string
  ): Promise<boolean> {
    return this.dm.sendHTMLWithInlineButton(clientUserId, html, buttonLabel, callbackData);
  }

  sendBusinessHTMLReply(input: BusinessAutomationReplyInput): Promise<boolean> {
    return this.business.sendHTMLReply(input);
  }

  sendBusinessMediaReply(input: BusinessAutomationReplyInput & { mediaPath: string }): Promise<boolean> {
    return this.business.sendMediaReply(input);
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
