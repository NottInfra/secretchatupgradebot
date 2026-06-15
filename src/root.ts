import { initEnv } from "./utils/env.js";
import { Store } from "./utils/db/root.js";
import process from "node:process";
import { ActionQueueService } from "./bg-services/action-queue-service.js";
import { AuthHttpService } from "./bg-services/auth-http-service.js";
import { MgmtBotService } from "./bg-services/mgmt-bot-service.js";
import { MtprotoSessionService } from "./bg-services/mtproto-session-service.js";
import { BotController } from "./controllers/bot-controller.js";
import { ChatAutomationController } from "./controllers/chat-automation-controller.js";
import { HandleUserMiddleware } from "./middleware/handle-user-middleware.js";
import { SessionModerationToggleMiddleware } from "./middleware/session-moderation-toggle-middleware.js";
import { ActionLogRepository } from "./repositories/action-log-repository.js";
import { MessageRepository } from "./repositories/message-repository.js";
import { SessionRepository } from "./repositories/session-repository.js";
import path from "node:path";
import { AuthChallengeService } from "./services/auth-challenge-service.js";
import { ClientNotificationService } from "./services/client-notification-service.js";
import { InboundMessageDedupe } from "./services/inbound-message-dedupe.js";
import { ExperimentService } from "./services/experiment-service.js";
import { OnboardingUseCase } from "./use-cases/onboarding.js";
import { BotRoutes } from "./routes/bot.js";
import { Analytics } from "./utils/analytics.js";
import { Logger } from "./utils/logger.js";
import { HandlePolicyUseCase } from "./use-cases/handle-policy.js";
import { ProcessIncomingMessageUseCase } from "./use-cases/process-incoming-message.js";
import { ExecuteModerationActionUseCase } from "./use-cases/execute-moderation-action.js";
import { ToggleModerationUseCase } from "./use-cases/toggle-moderation.js";

export const store = new Store();

void startApp();

export async function startApp(): Promise<void> {
  const env = await initEnv();
  const logger = new Logger();
  const analytics = new Analytics(store, logger);
  const handleUserMiddleware = new HandleUserMiddleware(store, analytics);
  const messages = new MessageRepository(store);
  const inboundDedupe = new InboundMessageDedupe();
  const actionLogs = new ActionLogRepository(store);
  const sessions = new SessionRepository(store);
  const sessionModerationToggle = new SessionModerationToggleMiddleware(sessions);
  const actionQueue = new ActionQueueService(logger);
  const authChallenges = new AuthChallengeService();
  const notifications = new ClientNotificationService(logger);
  const executeModerationAction = new ExecuteModerationActionUseCase(notifications, logger);
  const handlePolicyUseCase = new HandlePolicyUseCase(notifications, analytics, logger);
  const toggleModerationUseCase = new ToggleModerationUseCase(sessions, notifications, analytics, logger);
  const messageAssetRoot =
    env.NODE_ENV === "test" ? path.resolve("assets/messages-test") : path.resolve("assets/messages");
  const experiments = new ExperimentService(
    [
      path.join(messageAssetRoot, "message-warning"),
      path.join(messageAssetRoot, "message-warning-final"),
      path.join(messageAssetRoot, "messages-block")
    ],
    logger
  );

  const mtprotoSessions = new MtprotoSessionService(
    sessions,
    env.TELEGRAM_API_ID,
    env.TELEGRAM_API_HASH,
    env.TELEGRAM_USE_WSS,
    env.TELEGRAM_CONNECT_TIMEOUT_MS,
    logger
  );

  const useCase = new ProcessIncomingMessageUseCase(
    messages,
    inboundDedupe,
    actionLogs,
    executeModerationAction,
    actionQueue,
    analytics,
    logger,
    notifications,
    experiments,
    mtprotoSessions
  );

  const onboarding = new OnboardingUseCase(
    authChallenges,
    sessions,
    notifications,
    analytics,
    logger
  );

  const authHttpService = new AuthHttpService(env.AUTH_HTTP_PORT, authChallenges, logger);
  const botController = new BotController(onboarding, toggleModerationUseCase, notifications, logger);
  const chatAutomationController = new ChatAutomationController(
    useCase,
    sessionModerationToggle,
    sessions,
    logger
  );
  const botService = new MgmtBotService(
    env.MGMT_BOT_TOKEN,
    (bot) =>
      new BotRoutes(bot, {
        controller: botController,
        chatAutomation: chatAutomationController,
        handleUserMiddleware,
        handlePolicyUseCase
      }).bind(),
    notifications,
    logger
  );

  await authHttpService.start();
  await botService.start();

  const shutdown = async () => {
    logger.info("shutdown_requested");
    await botService.stop();
    await authHttpService.stop();
    await mtprotoSessions.stop();
    await store.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
