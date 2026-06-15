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
import { PendingBlockOfferStore } from "./services/pending-block-offer-store.js";
import { OnboardingUseCase } from "./use-cases/onboarding.js";
import { BotRoutes } from "./routes/bot.js";
import { Analytics } from "./utils/analytics.js";
import { getTracer, initTelemetry, shutdownTelemetry, withSpan } from "./utils/telemetry.js";
import { Logger } from "./utils/logger.js";
import { HandlePolicyUseCase } from "./use-cases/handle-policy.js";
import { ProcessIncomingMessageUseCase } from "./use-cases/process-incoming-message.js";
import { ExecuteModerationActionUseCase } from "./use-cases/execute-moderation-action.js";
import { HandleOwnerBlockCallbackUseCase } from "./use-cases/handle-owner-block-callback.js";
import { SendPriorBlockOwnerPromptUseCase } from "./use-cases/send-prior-block-owner-prompt.js";
import { ToggleModerationUseCase } from "./use-cases/toggle-moderation.js";

let store: Store;

void startApp().catch((error) => {
  console.error("[!] startup failed:", error);
  process.exit(1);
});

export async function startApp(): Promise<void> {
  const appTracer = getTracer("app");

  await withSpan(appTracer, "app.startup", async () => {
    const env = await withSpan(appTracer, "app.init_env", async () => initEnv());
    await withSpan(appTracer, "app.init_telemetry", async () => initTelemetry());
    store = new Store();
    const logger = new Logger();
    const analytics = new Analytics();
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
    const messageAssetRoot = path.resolve("assets/messages");
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

    const pendingBlockOffers = new PendingBlockOfferStore();
    const priorBlockOwnerPrompt = new SendPriorBlockOwnerPromptUseCase(
      pendingBlockOffers,
      notifications,
      analytics,
      logger
    );
    const handleOwnerBlockCallback = new HandleOwnerBlockCallbackUseCase(
      pendingBlockOffers,
      actionLogs,
      executeModerationAction,
      mtprotoSessions,
      experiments,
      notifications,
      analytics,
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
      mtprotoSessions,
      priorBlockOwnerPrompt
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
      notifications,
      logger
    );
    const botService = new MgmtBotService(
      env.MGMT_BOT_TOKEN,
      (bot) =>
        new BotRoutes(bot, {
          controller: botController,
          chatAutomation: chatAutomationController,
          handleOwnerBlockCallback,
          handleUserMiddleware,
          handlePolicyUseCase
        }).bind(),
      notifications,
      logger
    );

    await withSpan(appTracer, "app.start_auth_http", async () => authHttpService.start());
    await withSpan(appTracer, "app.start_mgmt_bot", async () => botService.start());

    const shutdown = async () => {
      await withSpan(appTracer, "app.shutdown", async () => {
        logger.info("shutdown_requested");
        await botService.stop();
        await authHttpService.stop();
        await mtprotoSessions.stop();
        await store.close();
        await shutdownTelemetry();
        process.exit(0);
      });
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  });
}
