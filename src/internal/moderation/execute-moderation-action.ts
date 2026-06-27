import type { IClientNotifications } from "../notifications/ports/client-notifications.port.js";
import type { ITelegramClient } from "../session/ports/telegram-client.port.js";
import type { BlockActionInput } from "../session/ports/execute-moderation-action.port.js";
import type { Logger } from "../lib/logger.js";
import { getTracer, setSpanAttributes, withSpan } from "../lib/telemetry.js";

const moderationTracer = getTracer("moderation");

export class ExecuteModerationActionUseCase {
  constructor(
    private readonly notifications: IClientNotifications,
    private readonly logger: Logger
  ) {}

  async execute(
    client: ITelegramClient,
    input: BlockActionInput
  ): Promise<boolean> {
    if (input.decision.action !== "block") return false;

    return withSpan(
      moderationTracer,
      "moderation.execute_block",
      async (span) => {
        setSpanAttributes(span, {
          "telegram.sender_id": input.senderId,
          "telegram.chat_id": input.moderationIncoming?.chatId
        });
        return this.executeBlock(client, input);
      }
    );
  }

  private async executeBlock(client: ITelegramClient, input: BlockActionInput): Promise<boolean> {
    const body = input.blockMessageHtml?.trim();
    if (!body) {
      this.logger.error("missing_block_template", { senderId: input.senderId });
      return false;
    }

    const replyToMsgId =
      typeof input.moderationIncoming?.telegramMessageId === "number" &&
      input.moderationIncoming.telegramMessageId > 0
        ? input.moderationIncoming.telegramMessageId
        : undefined;

    const businessConnectionId = input.moderationIncoming?.businessConnectionId;
    const viaBusinessAutomation =
      input.moderationIncoming?.source === "bot_api_automation" && Boolean(businessConnectionId);

    if (!viaBusinessAutomation) {
      this.logger.warn("block_without_business_automation", { senderId: input.senderId });
      return false;
    }

    await this.unblockContact(client, input.senderId);

    const blocked = await this.blockContact(client, input.senderId);
    if (!blocked) return false;

    const sent = await this.sendBlockViaBusinessAutomation(
      input,
      body,
      businessConnectionId!,
      replyToMsgId
    );
    if (!sent) {
      this.logger.error("failed_to_send_block_dm", {
        senderId: input.senderId,
        via: "business_automation"
      });
    }
    return true;
  }

  private async sendBlockViaBusinessAutomation(
    input: BlockActionInput,
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

  private async unblockContact(client: ITelegramClient, senderId: string): Promise<void> {
    const userId = Number(senderId);
    if (!Number.isFinite(userId)) return;

    try {
      await withSpan(moderationTracer, "moderation.unblock_contact", async () =>
        client.invoke({
          _: "setMessageSenderBlockList",
          sender_id: { _: "messageSenderUser", user_id: userId },
          block_list: null
        })
      );
      this.logger.info("sender_unblocked_for_notice", { senderId });
    } catch (error) {
      this.logger.debug("unblock_before_notice_skipped", { senderId, error: String(error) });
    }
  }

  private async blockContact(client: ITelegramClient, senderId: string): Promise<boolean> {
    const userId = Number(senderId);
    if (!Number.isFinite(userId)) {
      this.logger.error("failed_contacts_block_invalid_sender", { senderId });
      return false;
    }

    try {
      const me = await client.invoke({ _: "getMe" }) as { id?: number };
      if (me.id === userId) {
        this.logger.info("contacts_block_skipped_self_peer", { senderId });
        return false;
      }
    } catch (error) {
      this.logger.warn("contacts_block_get_me_failed", { senderId, error: String(error) });
    }

    try {
      await withSpan(moderationTracer, "moderation.block_contact", async () =>
        client.invoke({
          _: "setMessageSenderBlockList",
          sender_id: { _: "messageSenderUser", user_id: userId },
          block_list: { _: "blockListMain" }
        })
      );
      this.logger.info("sender_blocked", { senderId });
      return true;
    } catch (error) {
      this.logger.error("failed_contacts_block", {
        senderId,
        error: String(error)
      });
      return false;
    }
  }
}
