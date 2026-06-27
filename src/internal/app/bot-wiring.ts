import { ExecuteModerationActionUseCase } from "../moderation/execute-moderation-action.js";
import type { ClientNotificationService } from "../notifications/client-notification-service.js";
import { createSessionStack } from "../session/wiring.js";
import type { Analytics } from "../lib/analytics.js";
import type { Store } from "../lib/db/root.js";
import type { Env } from "../lib/env.js";
import type { Logger } from "../lib/logger.js";
import { createBotControllers } from "./controller-wiring.js";
import { createModerationStack } from "./moderation-wiring.js";
import { createPersistenceStack } from "./persistence-wiring.js";
import type { MgmtBotService } from "./mgmt-bot-service.js";
import type { SessionStack } from "../session/wiring.js";

export type BotRuntime = SessionStack & {
  botService: MgmtBotService;
};

export async function createBotRuntime(
  env: Env,
  store: Store,
  logger: Logger,
  analytics: Analytics,
  notifications: ClientNotificationService
): Promise<BotRuntime> {
  const persistence = createPersistenceStack(store, analytics);
  const executeModerationAction = new ExecuteModerationActionUseCase(notifications, logger);
  const session = await createSessionStack(env, notifications, logger, executeModerationAction);
  const moderation = createModerationStack(
    env,
    persistence,
    session.blockOnboarding,
    notifications,
    analytics,
    logger
  );
  const controllers = createBotControllers(env, persistence, session, moderation, notifications, analytics, logger);

  return {
    botService: controllers.botService,
    ownerSessions: session.ownerSessions,
    blockOnboarding: session.blockOnboarding
  };
}
