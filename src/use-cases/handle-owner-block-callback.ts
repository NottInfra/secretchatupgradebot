import type { ActionLogRepository } from "../repositories/action-log-repository.js";
import type { ClientNotificationService } from "../services/client-notification-service.js";
import type { ExperimentService } from "../services/experiment-service.js";
import type { PendingBlockOfferStore } from "../services/pending-block-offer-store.js";
import type { BlockOnboardingCoordinator } from "../services/session-provider/block-onboarding-coordinator.js";
import type { IncomingMessage } from "../types.js";
import { formatSenderRefHtml } from "../services/telegram/format-sender-ref.js";
import type { Analytics } from "../utils/analytics.js";
import type { Logger } from "../utils/logger.js";
import { getTracer, setSpanAttributes, withSpan } from "../utils/telemetry.js";

const moderationTracer = getTracer("moderation");
const LEVEL3_BLOCK_EXPERIMENT_ID = "level3_messages_block";

export class HandleOwnerBlockCallbackUseCase {
  constructor(
    private readonly offers: PendingBlockOfferStore,
    private readonly actions: ActionLogRepository,
    private readonly blockOnboarding: BlockOnboardingCoordinator,
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

      const senderRef = formatSenderRefHtml(offer.senderId, offer.senderUsername);
      const blocked = await withSpan(moderationTracer, "moderation.execute_owner_block", async () =>
        this.blockOnboarding.executeBlockWithSession(
          offer.ownerUserId,
          {
            senderId: offer.senderId,
            decision: {
              action: "block",
              confidence: 1,
              reason: "owner_prior_block_button"
            },
            blockMessageHtml,
            moderationIncoming: incoming
          },
          senderRef
        )
      );

      if (!blocked) {
        this.analytics.trackEvent("prior_block_owner_block_deferred_onboarding", {
          ownerUserId: offer.ownerUserId,
          senderId: offer.senderId
        });
        return "We need your Telegram session to block contacts — check the message I just sent for next steps.";
      }

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

      await this.notifications.sendHTML(
        offer.ownerUserId,
        `Blocked ${senderRef} on your account. Unblock them in Telegram if you want further contact.`
      );

      return "Sender blocked on your account.";
    });
  }
}
