import { Api, TelegramClient } from "telegram";
import type { IncomingMessage, ModerationDecision } from "../types.js";
import type { ClientNotificationService } from "../services/client-notification-service.js";
import { resolveOutboundPeer } from "../services/telegram/resolve-outbound-peer.js";
import type { Logger } from "../utils/logger.js";
import { getTracer, setSpanAttributes, withSpan } from "../utils/telemetry.js";

const moderationTracer = getTracer("moderation");

export class ExecuteModerationActionUseCase {
  constructor(
    private readonly notifications: ClientNotificationService,
    private readonly logger: Logger
  ) {}

  async execute(
    client: TelegramClient,
    input: {
      senderId: string;
      decision: ModerationDecision;
      blockMessageHtml?: string;
      /** MTProto path: peer resolution matches warning replies (Saved Messages / min peers). */
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

  private async executeBlock(
    client: TelegramClient,
    input: {
      senderId: string;
      decision: ModerationDecision;
      blockMessageHtml?: string;
      moderationIncoming?: IncomingMessage;
    }
  ): Promise<void> {
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
      const sent = await withSpan(moderationTracer, "moderation.send_block_message", async () =>
        this.notifications.sendBusinessHTMLReply({
        businessConnectionId: businessConnectionId!,
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
        return;
      }
      this.logger.info("block_notice_dm_sent", {
        senderId: input.senderId,
        chatId: input.moderationIncoming!.chatId,
        replyToMessageId: replyToMsgId,
        via: "business_automation"
      });
    } else {
      let entity: Awaited<ReturnType<TelegramClient["getInputEntity"]>>;
      try {
        entity = await withSpan(moderationTracer, "moderation.resolve_peer", async () =>
          input.moderationIncoming != null
            ? resolveOutboundPeer(client, input.moderationIncoming, this.logger)
            : client.getInputEntity(input.senderId)
        );
      } catch (error) {
        this.logger.error("failed_to_resolve_block_peer", {
          senderId: input.senderId,
          error: String(error)
        });
        return;
      }

      try {
        const sent = await withSpan(moderationTracer, "moderation.send_block_message", async () =>
          client.sendMessage(entity, {
            message: body,
            parseMode: "html",
            ...(replyToMsgId != null ? { replyTo: replyToMsgId } : {})
          })
        );
        const sentId = sent instanceof Api.Message ? sent.id : undefined;
        this.logger.info("block_notice_dm_sent", {
          senderId: input.senderId,
          chatId: input.moderationIncoming?.chatId,
          telegramSentMessageId: sentId,
          replyToMessageId: replyToMsgId,
          via: "mtproto"
        });
      } catch (error) {
        this.logger.error("failed_to_send_block_dm", {
          senderId: input.senderId,
          error: String(error)
        });
        return;
      }

      if (entity instanceof Api.InputPeerSelf) {
        this.logger.info("contacts_block_skipped_self_peer", { senderId: input.senderId });
        return;
      }

      try {
        await withSpan(moderationTracer, "moderation.block_contact", async () =>
          client.invoke(new Api.contacts.Block({ id: entity }))
        );
        this.logger.info("sender_blocked", { senderId: input.senderId });
      } catch (error) {
        this.logger.error("failed_contacts_block", {
          senderId: input.senderId,
          error: String(error)
        });
      }
      return;
    }

    let blockEntity: Awaited<ReturnType<TelegramClient["getInputEntity"]>>;
    try {
      blockEntity = await withSpan(moderationTracer, "moderation.resolve_peer", async () =>
        input.moderationIncoming != null
          ? resolveOutboundPeer(client, input.moderationIncoming, this.logger)
          : client.getInputEntity(input.senderId)
      );
    } catch (error) {
      this.logger.error("failed_to_resolve_block_peer", {
        senderId: input.senderId,
        error: String(error)
      });
      return;
    }

    if (blockEntity instanceof Api.InputPeerSelf) {
      this.logger.info("contacts_block_skipped_self_peer", { senderId: input.senderId });
      return;
    }

    try {
      await withSpan(moderationTracer, "moderation.block_contact", async () =>
        client.invoke(new Api.contacts.Block({ id: blockEntity }))
      );
      this.logger.info("sender_blocked", { senderId: input.senderId });
    } catch (error) {
      this.logger.error("failed_contacts_block", {
        senderId: input.senderId,
        error: String(error)
      });
    }
  }
}
