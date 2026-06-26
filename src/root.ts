import { initEnv } from "./utils/env.js";
import { Store } from "./utils/db/root.js";
import process from "node:process";
import { ActionQueueService } from "./bg-services/action-queue-service.js";
import { MgmtBotService } from "./bg-services/mgmt-bot-service.js";
import { BotController } from "./controllers/bot-controller.js";
import { ChatAutomationController } from "./controllers/chat-automation-controller.js";
import { HandleUserMiddleware } from "./middleware/handle-user-middleware.js";
import { SessionModerationToggleMiddleware } from "./middleware/session-moderation-toggle-middleware.js";
import { ActionLogRepository } from "./repositories/action-log-repository.js";
import { MessageRepository } from "./repositories/message-repository.js";
import { SessionRepository } from "./repositories/session-repository.js";
import path from "node:path";
import { ClientNotificationService } from "./services/client-notification-service.js";
import { InboundMessageDedupe } from "./services/inbound-message-dedupe.js";
import { ExperimentService } from "./services/experiment-service.js";
import { PendingBlockOfferStore } from "./services/pending-block-offer-store.js";
import { OwnerSessionService } from "./services/session-provider/owner-session-service.js";
import { BlockOnboardingCoordinator } from "./services/session-provider/block-onboarding-coordinator.js";
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

try {
  await startApp();
} catch (error) {
  console.error("[!] startup failed:", error);
  process.exit(1);
}

export async function startApp(): Promise<void> {
  const appTracer = getTracer("app");

  const env = await withSpan(appTracer, "app.init_env", async () => initEnv());
  await withSpan(appTracer, "app.init_telemetry", async () => initTelemetry());

  const { botService, ownerSessions, logger } = await withSpan(
    appTracer,
    "app.startup",
    async () => {
    store = new Store();
    const logger = new Logger();
    logger.info("config_loaded", {
      messageInstanceCollapseSeconds: env.MESSAGE_INSTANCE_COLLAPSE_SECONDS,
      nodeEnv: env.NODE_ENV
    });
    const analytics = new Analytics();
    const handleUserMiddleware = new HandleUserMiddleware(store, analytics);
    const messages = new MessageRepository(store);
    const inboundDedupe = new InboundMessageDedupe();
    const actionLogs = new ActionLogRepository(store);
    const sessions = new SessionRepository(store);
    const sessionModerationToggle = new SessionModerationToggleMiddleware(sessions);
    const actionQueue = new ActionQueueService(logger);
    const notifications = new ClientNotificationService(logger);
    const executeModerationAction = new ExecuteModerationActionUseCase(notifications, logger);
    const handlePolicyUseCase = new HandlePolicyUseCase(notifications, analytics, logger);
    const toggleModerationUseCase = new ToggleModerationUseCase(sessions, notifications, analytics, logger);
    const messageAssetRoot = path.resolve("assets/messages");
    const experiments = new ExperimentService(
      [path.join(messageAssetRoot, "message-warning"), path.join(messageAssetRoot, "messages-block")],
      logger
    );

    const ownerSessions = OwnerSessionService.create(
      {
        userId: env.SESSION_PROVIDER_USER_ID,
        apiKey: env.SESSION_PROVIDER_API_KEY,
        url: env.SESSION_PROVIDER_URL,
        svcName: env.SESSION_PROVIDER_SVC_NAME,
        sessionProviderRoot: env.SESSION_PROVIDER_ROOT,
        apiId: env.TELEGRAM_API_ID,
        apiHash: env.TELEGRAM_API_HASH
      },
      notifications,
      logger
    );
    await ownerSessions.start();

    const blockOnboarding = new BlockOnboardingCoordinator(
      ownerSessions,
      executeModerationAction,
      notifications,
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
      blockOnboarding,
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
      blockOnboarding,
      priorBlockOwnerPrompt,
      env.MESSAGE_INSTANCE_COLLAPSE_SECONDS
    );

    const botController = new BotController(blockOnboarding, toggleModerationUseCase, notifications, logger);
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
          handleOwnerBlockCallback,
          handleUserMiddleware,
          handlePolicyUseCase
        }).bind(),
      notifications,
      logger
    );

    return { botService, ownerSessions, logger };
    }
  );

  await withSpan(appTracer, "app.start_mgmt_bot", async () => botService.start());

  const shutdown = async () => {
    await withSpan(appTracer, "app.shutdown", async () => {
      logger.info("shutdown_requested");
      await botService.stop();
      await ownerSessions.stop();
      await store.close();
      await shutdownTelemetry();
      process.exit(0);
    });
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
