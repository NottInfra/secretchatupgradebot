import { Api, TelegramClient } from "telegram";
import type { IncomingMessage, ModerationDecision } from "../types.js";
import type { ClientNotificationService } from "../services/client-notification-service.js";
import { resolveOutboundPeer } from "../utils/mtproto-resolve-outbound-peer.js";
import type { Logger } from "../utils/logger.js";

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
      const sent = await this.notifications.sendBusinessHTMLReply({
        businessConnectionId: businessConnectionId!,
        chatId: input.moderationIncoming!.chatId,
        html: body,
        replyToMessageId: replyToMsgId
      });
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
        entity =
          input.moderationIncoming != null
            ? await resolveOutboundPeer(client, input.moderationIncoming, this.logger)
            : await client.getInputEntity(input.senderId);
      } catch (error) {
        this.logger.error("failed_to_resolve_block_peer", {
          senderId: input.senderId,
          error: String(error)
        });
        return;
      }

      try {
        const sent = await client.sendMessage(entity, {
          message: body,
          parseMode: "html",
          ...(replyToMsgId != null ? { replyTo: replyToMsgId } : {})
        });
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
        await client.invoke(new Api.contacts.Block({ id: entity }));
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
      blockEntity =
        input.moderationIncoming != null
          ? await resolveOutboundPeer(client, input.moderationIncoming, this.logger)
          : await client.getInputEntity(input.senderId);
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
      await client.invoke(new Api.contacts.Block({ id: blockEntity }));
      this.logger.info("sender_blocked", { senderId: input.senderId });
    } catch (error) {
      this.logger.error("failed_contacts_block", {
        senderId: input.senderId,
        error: String(error)
      });
    }
  }
}
