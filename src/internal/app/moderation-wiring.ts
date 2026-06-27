import path from "node:path";
import { ActionQueueService } from "../moderation/action-queue-service.js";
import { createModerationContainer, type ModerationContainer } from "../moderation/container.js";
import { HandleOwnerBlockCallbackUseCase } from "../moderation/handle-owner-block-callback.js";
import { InboundMessageDedupe } from "../moderation/inbound-message-dedupe.js";
import { ModerationReplyService } from "../moderation/moderation-reply-service.js";
import { PendingBlockOfferStore } from "../moderation/pending-block-offer-store.js";
import type { IBlockOnboarding } from "../session/ports/block-onboarding.port.js";
import type { IClientNotifications } from "../notifications/ports/client-notifications.port.js";
import { ExperimentService } from "../moderation/experiments/experiment-service.js";
import type { Analytics } from "../lib/analytics.js";
import type { Env } from "../lib/env.js";
import type { Logger } from "../lib/logger.js";
import type { PersistenceStack } from "./persistence-wiring.js";

export type ModerationStack = ModerationContainer & {
  handleOwnerBlockCallback: HandleOwnerBlockCallbackUseCase;
};

export function createModerationStack(
  env: Env,
  persistence: PersistenceStack,
  blockOnboarding: IBlockOnboarding,
  notifications: IClientNotifications,
  analytics: Analytics,
  logger: Logger
): ModerationStack {
  const actionQueue = new ActionQueueService(logger);
  const moderationReply = new ModerationReplyService(notifications, logger);
  const inboundDedupe = new InboundMessageDedupe();
  const pendingBlockOffers = new PendingBlockOfferStore();

  const messageAssetRoot = path.resolve("assets/messages");
  const experiments = new ExperimentService(
    [path.join(messageAssetRoot, "message-warning"), path.join(messageAssetRoot, "messages-block")],
    logger
  );

  const moderation = createModerationContainer({
    messages: persistence.messages,
    inboundDedupe,
    actionLogs: persistence.actionLogs,
    experiments,
    actionQueue,
    moderationReply,
    blockOnboarding,
    pendingBlockOffers,
    notifications,
    analytics,
    logger,
    messageInstanceCollapseSeconds: env.MESSAGE_INSTANCE_COLLAPSE_SECONDS
  });

  const handleOwnerBlockCallback = new HandleOwnerBlockCallbackUseCase(
    pendingBlockOffers,
    persistence.actionLogs,
    blockOnboarding,
    experiments,
    notifications,
    analytics,
    logger
  );

  return {
    ...moderation,
    handleOwnerBlockCallback
  };
}
