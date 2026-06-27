import type { IActionLogRepository } from "./ports/action-log-repository.port.js";
import type { IClientNotifications } from "../notifications/ports/client-notifications.port.js";
import type { IExperimentService } from "./experiments/experiment-service.port.js";
import type { IPendingBlockOfferStore } from "./ports/pending-block-offer.port.js";
import type { IBlockOnboarding } from "../session/ports/block-onboarding.port.js";
import { formatSenderRefHtml } from "../lib/telegram/format-sender-ref.js";
import type { IncomingMessage } from "../lib/types/index.js";
import type { Analytics } from "../lib/analytics.js";
import type { Logger } from "../lib/logger.js";
import { getTracer, setSpanAttributes, withSpan } from "../lib/telemetry.js";

const moderationTracer = getTracer("moderation");
const LEVEL3_BLOCK_EXPERIMENT_ID = "level3_messages_block";

export class HandleOwnerBlockCallbackUseCase {
  constructor(
    private readonly offers: IPendingBlockOfferStore,
    private readonly actions: IActionLogRepository,
    private readonly blockOnboarding: IBlockOnboarding,
    private readonly experiments: IExperimentService,
    private readonly notifications: IClientNotifications,
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
        incomingMessageId: offer.incomingMessageId,
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
