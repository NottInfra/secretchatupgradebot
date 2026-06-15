import { Telegraf } from "telegraf";
import { ClientNotificationService } from "../services/client-notification-service.js";
import type { Logger } from "../utils/logger.js";

/** Telegram Business updates — typegram typings may lag Bot API. */
const MGMT_BOT_ALLOWED_UPDATES = [
  "message",
  "edited_message",
  "business_connection",
  "business_message",
  "edited_business_message",
  "deleted_business_messages"
] as NonNullable<Telegraf.LaunchOptions["allowedUpdates"]>;

export class MgmtBotService {
  private bot?: Telegraf;

  constructor(
    private readonly token: string | undefined,
    private readonly bindRoutes: (bot: Telegraf) => void,
    private readonly notifications: ClientNotificationService,
    private readonly logger: Logger
  ) {}

  async start(): Promise<void> {
    if (!this.token) {
      this.logger.warn("mgmt_bot_not_started_missing_token");
      return;
    }
    const bot = new Telegraf(this.token);
    this.bindRoutes(bot);
    // Attach early so notification sends work during startup too.
    this.notifications.attachBot(bot);
    this.bot = bot;
    this.logger.info("mgmt_bot_launching");
    try {
      // Explicit probe so failures (invalid token / network / DNS) are visible before long-polling.
      const me = await bot.telegram.getMe();
      this.logger.info("mgmt_bot_identity_ok", { username: me.username, id: me.id });
      await bot.launch({ allowedUpdates: MGMT_BOT_ALLOWED_UPDATES });
      this.logger.info("mgmt_bot_started");
    } catch (error) {
      this.bot = undefined;
      this.logger.error("mgmt_bot_launch_failed", { error: String(error) });
    }
  }

  async stop(): Promise<void> {
    this.bot?.stop();
  }
}
