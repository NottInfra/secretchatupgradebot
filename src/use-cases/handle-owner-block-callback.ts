import type { ActionLogRepository } from "../repositories/action-log-repository.js";
import type { MtprotoSessionService } from "../bg-services/mtproto-session-service.js";
import type { ClientNotificationService } from "../services/client-notification-service.js";
import type { ExperimentService } from "../services/experiment-service.js";
import type { PendingBlockOfferStore } from "../services/pending-block-offer-store.js";
import type { IncomingMessage } from "../types.js";
import type { Analytics } from "../utils/analytics.js";
import type { Logger } from "../utils/logger.js";
import { getTracer, setSpanAttributes, withSpan } from "../utils/telemetry.js";
import { ExecuteModerationActionUseCase } from "./execute-moderation-action.js";

const moderationTracer = getTracer("moderation");
const LEVEL3_BLOCK_EXPERIMENT_ID = "level3_messages_block";

export class HandleOwnerBlockCallbackUseCase {
  constructor(
    private readonly offers: PendingBlockOfferStore,
    private readonly actions: ActionLogRepository,
    private readonly executeModerationAction: ExecuteModerationActionUseCase,
    private readonly mtprotoSessions: MtprotoSessionService,
    private readonly experiments: ExperimentService,
    private readonly notifications: ClientNotificationService,
    private readonly analytics: Analytics,
    private readonly logger: Logger
  ) {}

  async execute(ownerUserId: number, token: string): Promise<string> {
    return withSpan(moderationTracer, "moderation.owner_block_callback", async (span) => {
      setSpanAttributes(span, { "telegram.user_id": ownerUserId, "offer.token": token });

      const offer = this.offers.consume(token, String(ownerUserId));
      if (!offer) {
        this.analytics.trackEvent("prior_block_owner_prompt_expired", { ownerUserId, token });
        return "This block offer expired. Send another message to the sender to get a new prompt.";
      }

      if (await this.actions.hasPriorBlockInSession(offer.senderId, offer.ownerUserId)) {
        return "This sender is already blocked on your account.";
      }

      const client = await this.mtprotoSessions.getClientForBlock(offer.ownerUserId);
      if (!client) {
        this.analytics.trackEvent("prior_block_owner_block_skipped_no_session", {
          ownerUserId: offer.ownerUserId,
          senderId: offer.senderId
        });
        this.logger.warn("prior_block_owner_block_skipped_no_session", {
          ownerUserId: offer.ownerUserId,
          senderId: offer.senderId
        });
        return "Complete /start onboarding first — we need your Telegram session to block contacts.";
      }

      const assignment = this.experiments.assignModerationTier(
        LEVEL3_BLOCK_EXPERIMENT_ID,
        offer.senderId
      );
      const blockMessageHtml = assignment.html.replaceAll(
        "{{SESSION_USERNAME}}",
        offer.sessionOwnerUsername ? `@${offer.sessionOwnerUsername}` : "This account"
      );

      const incoming: IncomingMessage = {
        sessionId: offer.ownerUserId,
        chatId: offer.chatId,
        senderId: offer.senderId,
        sessionOwnerUsername: offer.sessionOwnerUsername,
        text: "",
        date: new Date(),
        telegramMessageId: offer.telegramMessageId,
        source: offer.businessConnectionId ? "bot_api_automation" : undefined,
        businessConnectionId: offer.businessConnectionId
      };

      await withSpan(moderationTracer, "moderation.execute_owner_block", async () =>
        this.executeModerationAction.execute(client, {
          senderId: offer.senderId,
          decision: {
            action: "block",
            confidence: 1,
            reason: "owner_prior_block_button"
          },
          blockMessageHtml,
          moderationIncoming: incoming
        })
      );

      this.actions.saveDeferred({
        senderId: offer.senderId,
        chatId: offer.chatId,
        sessionId: offer.ownerUserId,
        decision: {
          action: "block",
          confidence: 1,
          reason: "owner_prior_block_button"
        }
      });

      this.analytics.trackEvent("prior_block_owner_confirmed", {
        ownerUserId: offer.ownerUserId,
        senderId: offer.senderId,
        chatId: offer.chatId,
        experiment: assignment.experimentId,
        variant: assignment.variantId
      });
      this.logger.info("prior_block_owner_confirmed", {
        ownerUserId: offer.ownerUserId,
        senderId: offer.senderId,
        chatId: offer.chatId
      });

      const senderRef = offer.senderId;
      await this.notifications.sendHTML(
        offer.ownerUserId,
        `Blocked user ID ${senderRef} on your account. Unblock them in Telegram if you want further contact.`
      );

      return "Sender blocked on your account.";
    });
  }
}
