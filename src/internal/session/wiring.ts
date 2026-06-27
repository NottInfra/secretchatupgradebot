import type { IExecuteModerationAction } from "./ports/execute-moderation-action.port.js";
import { BlockOnboardingCoordinator } from "./block-onboarding-coordinator.js";
import { OwnerSessionService } from "./owner-session-service.js";
import type { IClientNotifications } from "../notifications/ports/client-notifications.port.js";
import type { Env } from "../lib/env.js";
import type { Logger } from "../lib/logger.js";

export type SessionStack = {
  ownerSessions: OwnerSessionService;
  blockOnboarding: BlockOnboardingCoordinator;
};

export async function createSessionStack(
  env: Env,
  notifications: IClientNotifications,
  logger: Logger,
  executeModerationAction: IExecuteModerationAction
): Promise<SessionStack> {
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

  return { ownerSessions, blockOnboarding };
}
