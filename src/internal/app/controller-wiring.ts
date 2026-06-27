import { MgmtBotService } from "./mgmt-bot-service.js";
import { BotController } from "./controllers/bot-controller.js";
import { ChatAutomationController } from "./controllers/chat-automation-controller.js";
import { BotRoutes } from "./routes/bot.js";
import type { ClientNotificationService } from "../notifications/client-notification-service.js";
import { HandlePolicyUseCase } from "./use-cases/handle-policy.js";
import { ToggleModerationUseCase } from "./use-cases/toggle-moderation.js";
import type { Analytics } from "../lib/analytics.js";
import type { Env } from "../lib/env.js";
import type { Logger } from "../lib/logger.js";
import type { ModerationStack } from "./moderation-wiring.js";
import type { PersistenceStack } from "./persistence-wiring.js";
import type { SessionStack } from "../session/wiring.js";

export function createBotControllers(
  env: Env,
  persistence: PersistenceStack,
  session: SessionStack,
  moderation: ModerationStack,
  notifications: ClientNotificationService,
  analytics: Analytics,
  logger: Logger
): { botService: MgmtBotService } {
  const handlePolicyUseCase = new HandlePolicyUseCase(notifications, analytics, logger);
  const toggleModerationUseCase = new ToggleModerationUseCase(
    persistence.sessions,
    notifications,
    analytics,
    logger
  );

  const botController = new BotController(session.blockOnboarding, toggleModerationUseCase, notifications, logger);
  const chatAutomationController = new ChatAutomationController(
    moderation.processIncomingMessage,
    persistence.sessionModerationToggle,
    persistence.sessions,
    logger
  );

  const botService = new MgmtBotService(
    env.MGMT_BOT_TOKEN,
    (telegraf) =>
      new BotRoutes(telegraf, {
        controller: botController,
        chatAutomation: chatAutomationController,
        handleOwnerBlockCallback: moderation.handleOwnerBlockCallback,
        handleUserMiddleware: persistence.handleUserMiddleware,
        handlePolicyUseCase
      }).bind(),
    notifications,
    logger
  );

  return { botService };
}
