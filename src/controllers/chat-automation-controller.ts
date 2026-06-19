import type { Context } from "telegraf";
import type { SessionRepository } from "../repositories/session-repository.js";
import type { SessionModerationToggleMiddleware } from "../middleware/session-moderation-toggle-middleware.js";
import type { ProcessIncomingMessageUseCase } from "../use-cases/process-incoming-message.js";
import type { Logger } from "../utils/logger.js";
import { formatError } from "../utils/format-error.js";
import { getTracer, setSpanAttributes, withRootSpan, withSpan } from "../utils/telemetry.js";

const chatAutomationTracer = getTracer("chat_automation");

/**
 * Bot API path for messages tied to a user's account via Business / Chat Automation.
 * Telegram delivers `business_message` with `business_connection_id`; we resolve the
 * owning user and moderate when they have toggled moderation on.
 */
type AutomationMessageShape = {
  message_id: number;
  chat: { id: number; type?: string };
  from?: { id: number; is_bot?: boolean; username?: string };
  text?: string;
  business_connection_id?: string;
  /** Present when the connected bot sent this message on behalf of the business account. */
  sender_business_bot?: { id: number; username?: string };
};

function extractAutomationMessage(update: object): AutomationMessageShape | undefined {
  const record = update as Record<string, unknown>;
  const bm = record.business_message as AutomationMessageShape | undefined;
  if (bm && typeof bm.business_connection_id === "string" && bm.business_connection_id.length > 0) {
    return bm;
  }
  const m = record.message as AutomationMessageShape | undefined;
  if (m && typeof m.business_connection_id === "string" && m.business_connection_id.length > 0) {
    return m;
  }
  return undefined;
}

export class ChatAutomationController {
  constructor(
    private readonly processIncoming: ProcessIncomingMessageUseCase,
    private readonly sessionModeration: SessionModerationToggleMiddleware,
    private readonly sessions: SessionRepository,
    private readonly logger: Logger
  ) {}

  /**
   * @returns true if this update was handled here (do not run normal bot command handlers)
   */
  async tryHandle(ctx: Context): Promise<boolean> {
    const msg = extractAutomationMessage(ctx.update);
    if (!msg) return false;

    if (msg.chat.type && msg.chat.type !== "private") return false;
    const from = msg.from;
    if (!from || from.is_bot) return false;

    const bcId = msg.business_connection_id;
    if (!bcId) return false;

    return withRootSpan(
      chatAutomationTracer,
      "chat_automation.handle_update",
      async (span) => {
        setSpanAttributes(span, {
          "telegram.business_connection_id": bcId,
          "telegram.chat_id": String(msg.chat.id),
          "telegram.message_id": msg.message_id
        });

        let ownerUserId: string;
        let sessionOwnerUsername: string | undefined;
        try {
          const tg = ctx.telegram as unknown as {
            callApi<M extends string, P extends object>(
              method: M,
              payload: P
            ): Promise<{ user?: { id: number; username?: string } }>;
          };
          const conn = await withSpan(
            chatAutomationTracer,
            "chat_automation.get_business_connection",
            async () => tg.callApi("getBusinessConnection", { business_connection_id: bcId })
          );
          const id = conn.user?.id;
          if (typeof id !== "number") {
            this.logger.warn("chat_automation_connection_missing_user", { businessConnectionId: bcId });
            return true;
          }
          ownerUserId = String(id);
          sessionOwnerUsername =
            typeof conn.user?.username === "string" && conn.user.username.length > 0
              ? conn.user.username
              : undefined;
        } catch (error) {
          this.logger.error("chat_automation_get_connection_failed", {
            businessConnectionId: bcId,
            error: formatError(error)
          });
          return true;
        }

        try {
          await withSpan(chatAutomationTracer, "chat_automation.ensure_moderation_row", async () => {
            const record = await this.sessions.findByUserId(ownerUserId);
            if (!record) {
              await this.sessions.ensureUser(ownerUserId);
            }
          });
        } catch (error) {
          this.logger.error("chat_automation_session_db_failed", {
            businessConnectionId: bcId,
            ownerUserId,
            error: formatError(error)
          });
          return true;
        }

        let enabled: boolean;
        try {
          enabled = await this.sessionModeration.isEnabled(ownerUserId);
        } catch (error) {
          this.logger.error("chat_automation_session_db_failed", {
            businessConnectionId: bcId,
            ownerUserId,
            error: formatError(error)
          });
          return true;
        }
        if (!enabled) {
          this.logger.info("chat_automation_skipped_moderation_off", {
            ownerUserId,
            chatId: String(msg.chat.id),
            messageId: msg.message_id
          });
          return true;
        }

        const text =
          typeof msg.text === "string" && msg.text.trim().length > 0 ? msg.text : "[non-text message]";
        const senderUsername =
          typeof from.username === "string" && from.username.length > 0 ? from.username : undefined;
        const senderId = String(from.id);

        if (msg.sender_business_bot != null) {
          this.logger.info("chat_automation_skipped_bot_business_send", {
            ownerUserId,
            chatId: String(msg.chat.id),
            messageId: msg.message_id,
            botId: msg.sender_business_bot.id
          });
          return true;
        }

        if (senderId === ownerUserId) {
          this.logger.info("chat_automation_skipped_owner_outbound", {
            ownerUserId,
            chatId: String(msg.chat.id),
            messageId: msg.message_id
          });
          return true;
        }

        this.logger.info("chat_automation_inbound", {
          ownerUserId,
          chatId: String(msg.chat.id),
          senderId,
          messageId: msg.message_id,
          businessConnectionId: bcId
        });

        try {
          await this.processIncoming.execute({
            sessionId: ownerUserId,
            chatId: String(msg.chat.id),
            senderId,
            senderUsername,
            sessionOwnerUsername,
            senderIsBot: Boolean(from.is_bot),
            text,
            date: new Date(),
            telegramMessageId: typeof msg.message_id === "number" ? msg.message_id : undefined,
            businessConnectionId: bcId,
            source: "bot_api_automation"
          });
        } catch (error) {
          this.logger.error("chat_automation_process_failed", {
            ownerUserId,
            error: formatError(error)
          });
        }
        return true;
      }
    );
  }
}
