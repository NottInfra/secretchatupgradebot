import { Store } from "../lib/db/root.js";
import type { Env } from "../lib/env.js";
import { Logger } from "../lib/logger.js";
import { Analytics } from "../lib/analytics.js";
import { ClientNotificationService } from "../notifications/client-notification-service.js";
import type { AppRuntime } from "./app-runtime.js";
import { createBotRuntime } from "./bot-wiring.js";

export async function createApp(env: Env): Promise<AppRuntime> {
  const store = new Store();
  const logger = new Logger();
  logger.info("config_loaded", {
    messageInstanceCollapseSeconds: env.MESSAGE_INSTANCE_COLLAPSE_SECONDS,
    nodeEnv: env.NODE_ENV
  });

  const analytics = new Analytics();
  const notifications = new ClientNotificationService(logger);
  const bot = await createBotRuntime(env, store, logger, analytics, notifications);

  return {
    store,
    botService: bot.botService,
    ownerSessions: bot.ownerSessions,
    logger
  };
}
