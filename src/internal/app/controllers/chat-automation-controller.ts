import type { Context } from "telegraf";
import type { ISessionRepository } from "../../session/ports/session-repository.port.js";
import type { SessionModerationToggleMiddleware } from "../middleware/session-moderation-toggle-middleware.js";
import type { IProcessIncomingMessage } from "../../moderation/ports/process-incoming-message.port.js";
import type { Logger } from "../../lib/logger.js";
import { formatError } from "../../lib/format-error.js";
import { getTracer, setSpanAttributes, withRootSpan, withSpan } from "../../lib/telemetry.js";
import {
  extractAutomationMessage,
  resolveBusinessConnectionOwner
} from "../../lib/telegram/automation-message.js";
import { shouldSkipAutomationMessage } from "../../lib/telegram/automation-guards.js";

const chatAutomationTracer = getTracer("chat_automation");

export class ChatAutomationController {
  constructor(
    private readonly processIncoming: IProcessIncomingMessage,
    private readonly sessionModeration: SessionModerationToggleMiddleware,
    private readonly sessions: ISessionRepository,
    private readonly logger: Logger
  ) {}

  async tryHandle(ctx: Context): Promise<boolean> {
    const msg = extractAutomationMessage(ctx.update);
    if (!msg) return false;
    if (msg.chat.type && msg.chat.type !== "private") return false;

    const from = msg.from;
    if (!from || from.is_bot) return false;

    const bcId = msg.business_connection_id;
    if (!bcId) return false;

    await withRootSpan(chatAutomationTracer, "chat_automation.handle_update", async (span) => {
      setSpanAttributes(span, {
        "telegram.business_connection_id": bcId,
        "telegram.chat_id": String(msg.chat.id),
        "telegram.message_id": msg.message_id
      });
      await this.handleAutomationUpdate(ctx, msg, from, bcId);
    });
    return true;
  }

  private async handleAutomationUpdate(
    ctx: Context,
    msg: NonNullable<ReturnType<typeof extractAutomationMessage>>,
    from: NonNullable<NonNullable<ReturnType<typeof extractAutomationMessage>>["from"]>,
    businessConnectionId: string
  ): Promise<void> {
    const owner = await this.resolveOwner(ctx, businessConnectionId);
    if (!owner) return;

    if (!(await this.ensureSessionReady(owner.ownerUserId, businessConnectionId))) return;
    if (!(await this.isModerationEnabled(owner.ownerUserId, businessConnectionId))) return;
    if (this.shouldSkipMessage(msg, from, owner.ownerUserId)) return;

    await this.processMessage(msg, from, owner, businessConnectionId);
  }

  private async resolveOwner(
    ctx: Context,
    businessConnectionId: string
  ): Promise<{ ownerUserId: string; sessionOwnerUsername: string | undefined } | undefined> {
    try {
      const owner = await withSpan(
        chatAutomationTracer,
        "chat_automation.get_business_connection",
        async () =>
          resolveBusinessConnectionOwner(
            ctx.telegram as Parameters<typeof resolveBusinessConnectionOwner>[0],
            businessConnectionId
          )
      );
      if (!owner) {
        this.logger.warn("chat_automation_connection_missing_user", { businessConnectionId });
      }
      return owner;
    } catch (error) {
      this.logger.error("chat_automation_get_connection_failed", {
        businessConnectionId,
        error: formatError(error)
      });
      return undefined;
    }
  }

  private async ensureSessionReady(ownerUserId: string, businessConnectionId: string): Promise<boolean> {
    try {
      await withSpan(chatAutomationTracer, "chat_automation.ensure_moderation_row", async () => {
        const record = await this.sessions.findByUserId(ownerUserId);
        if (!record) {
          await this.sessions.ensureUser(ownerUserId);
        }
      });
      return true;
    } catch (error) {
      this.logger.error("chat_automation_session_db_failed", {
        businessConnectionId,
        ownerUserId,
        error: formatError(error)
      });
      return false;
    }
  }

  private async isModerationEnabled(ownerUserId: string, businessConnectionId: string): Promise<boolean> {
    try {
      const enabled = await this.sessionModeration.isEnabled(ownerUserId);
      if (!enabled) {
        this.logger.info("chat_automation_skipped_moderation_off", { ownerUserId });
      }
      return enabled;
    } catch (error) {
      this.logger.error("chat_automation_session_db_failed", {
        businessConnectionId,
        ownerUserId,
        error: formatError(error)
      });
      return false;
    }
  }

  private shouldSkipMessage(
    msg: NonNullable<ReturnType<typeof extractAutomationMessage>>,
    from: NonNullable<NonNullable<ReturnType<typeof extractAutomationMessage>>["from"]>,
    ownerUserId: string
  ): boolean {
    const decision = shouldSkipAutomationMessage(msg, from, ownerUserId);
    if (!decision.skip) return false;

    if (decision.reason === "bot_business_send") {
      this.logger.info("chat_automation_skipped_bot_business_send", {
        ownerUserId,
        chatId: String(msg.chat.id),
        messageId: msg.message_id,
        botId: msg.sender_business_bot!.id
      });
      return true;
    }

    this.logger.info("chat_automation_skipped_owner_outbound", {
      ownerUserId,
      chatId: String(msg.chat.id),
      messageId: msg.message_id
    });
    return true;
  }

  private async processMessage(
    msg: NonNullable<ReturnType<typeof extractAutomationMessage>>,
    from: NonNullable<NonNullable<ReturnType<typeof extractAutomationMessage>>["from"]>,
    owner: { ownerUserId: string; sessionOwnerUsername: string | undefined },
    businessConnectionId: string
  ): Promise<void> {
    const text =
      typeof msg.text === "string" && msg.text.trim().length > 0 ? msg.text : "[non-text message]";
    const senderUsername =
      typeof from.username === "string" && from.username.length > 0 ? from.username : undefined;

    this.logger.info("chat_automation_inbound", {
      ownerUserId: owner.ownerUserId,
      chatId: String(msg.chat.id),
      senderId: String(from.id),
      messageId: msg.message_id,
      businessConnectionId
    });

    try {
      await this.processIncoming.execute({
        sessionId: owner.ownerUserId,
        chatId: String(msg.chat.id),
        senderId: String(from.id),
        senderUsername,
        sessionOwnerUsername: owner.sessionOwnerUsername,
        senderIsBot: Boolean(from.is_bot),
        text,
        date: new Date(),
        telegramMessageId: typeof msg.message_id === "number" ? msg.message_id : undefined,
        businessConnectionId,
        source: "bot_api_automation"
      });
    } catch (error) {
      this.logger.error("chat_automation_process_failed", {
        ownerUserId: owner.ownerUserId,
        error: formatError(error)
      });
    }
  }
}
