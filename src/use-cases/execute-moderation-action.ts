import type { IncomingMessage, ModerationDecision } from "../types.js";
import type { ClientNotificationService } from "../services/client-notification-service.js";
import type { TdlibClient } from "../services/telegram/tdlib-client.js";
import type { Logger } from "../utils/logger.js";
import { getTracer, setSpanAttributes, withSpan } from "../utils/telemetry.js";

const moderationTracer = getTracer("moderation");

type BlockInput = {
  senderId: string;
  decision: ModerationDecision;
  blockMessageHtml?: string;
  moderationIncoming?: IncomingMessage;
};

export class ExecuteModerationActionUseCase {
  constructor(
    private readonly notifications: ClientNotificationService,
    private readonly logger: Logger
  ) {}

  async execute(
    client: TdlibClient,
    input: {
      senderId: string;
      decision: ModerationDecision;
      blockMessageHtml?: string;
      moderationIncoming?: IncomingMessage;
    }
  ): Promise<void> {
    if (input.decision.action !== "block") return;

    return withSpan(
      moderationTracer,
      "moderation.execute_block",
      async (span) => {
        setSpanAttributes(span, {
          "telegram.sender_id": input.senderId,
          "telegram.chat_id": input.moderationIncoming?.chatId
        });
        await this.executeBlock(client, input);
      }
    );
  }

  private async executeBlock(client: TdlibClient, input: BlockInput): Promise<void> {
    const body = input.blockMessageHtml?.trim();
    if (!body) {
      this.logger.error("missing_block_template", { senderId: input.senderId });
      return;
    }

    const replyToMsgId =
      typeof input.moderationIncoming?.telegramMessageId === "number" &&
      input.moderationIncoming.telegramMessageId > 0
        ? input.moderationIncoming.telegramMessageId
        : undefined;

    const businessConnectionId = input.moderationIncoming?.businessConnectionId;
    const viaBusinessAutomation =
      input.moderationIncoming?.source === "bot_api_automation" && Boolean(businessConnectionId);

    if (viaBusinessAutomation) {
      const sent = await this.sendBlockViaBusinessAutomation(
        input,
        body,
        businessConnectionId!,
        replyToMsgId
      );
      if (!sent) return;
      await this.blockContact(client, input.senderId);
      return;
    }

    this.logger.warn("block_without_business_automation", { senderId: input.senderId });
  }

  private async sendBlockViaBusinessAutomation(
    input: BlockInput,
    body: string,
    businessConnectionId: string,
    replyToMsgId: number | undefined
  ): Promise<boolean> {
    const sent = await withSpan(moderationTracer, "moderation.send_block_message", async () =>
      this.notifications.sendBusinessHTMLReply({
        businessConnectionId,
        chatId: input.moderationIncoming!.chatId,
        html: body,
        replyToMessageId: replyToMsgId
      })
    );
    if (!sent) {
      this.logger.error("failed_to_send_block_dm", {
        senderId: input.senderId,
        via: "business_automation"
      });
      return false;
    }
    this.logger.info("block_notice_dm_sent", {
      senderId: input.senderId,
      chatId: input.moderationIncoming!.chatId,
      replyToMessageId: replyToMsgId,
      via: "business_automation"
    });
    return true;
  }

  private async blockContact(client: TdlibClient, senderId: string): Promise<void> {
    const userId = Number(senderId);
    if (!Number.isFinite(userId)) {
      this.logger.error("failed_contacts_block_invalid_sender", { senderId });
      return;
    }

    try {
      const me = await client.invoke({ _: "getMe" }) as { id?: number };
      if (me.id === userId) {
        this.logger.info("contacts_block_skipped_self_peer", { senderId });
        return;
      }
    } catch (error) {
      this.logger.warn("contacts_block_get_me_failed", { senderId, error: String(error) });
    }

    try {
      await withSpan(moderationTracer, "moderation.block_contact", async () =>
        client.invoke({
          _: "blockMessageSender",
          sender_id: { _: "messageSenderUser", user_id: userId },
          block_list: { _: "blockListMain" }
        })
      );
      this.logger.info("sender_blocked", { senderId });
    } catch (error) {
      this.logger.error("failed_contacts_block", {
        senderId,
        error: String(error)
      });
    }
  }
}
