import type { IMessageRepository } from "./ports/message-repository.port.js";
import type { IActionLogRepository } from "./ports/action-log-repository.port.js";
import type { ActionQueueService } from "./action-queue-service.js";
import type { IExperimentService } from "./experiments/experiment-service.port.js";
import type { IInboundMessageDedupe } from "./ports/inbound-message-dedupe.port.js";
import type { IModerationReply } from "./ports/moderation-reply.port.js";
import type { IBlockOnboarding } from "../session/ports/block-onboarding.port.js";
import type { IPendingBlockOfferStore } from "./ports/pending-block-offer.port.js";
import type { IClientNotifications } from "../notifications/ports/client-notifications.port.js";
import type { Analytics } from "../lib/analytics.js";
import type { Logger } from "../lib/logger.js";

export type ModerationDeps = {
  messages: IMessageRepository;
  inboundDedupe: IInboundMessageDedupe;
  actionLogs: IActionLogRepository;
  experiments: IExperimentService;
  actionQueue: ActionQueueService;
  moderationReply: IModerationReply;
  blockOnboarding: IBlockOnboarding;
  pendingBlockOffers: IPendingBlockOfferStore;
  notifications: IClientNotifications;
  analytics: Analytics;
  logger: Logger;
  messageInstanceCollapseSeconds: number;
};
