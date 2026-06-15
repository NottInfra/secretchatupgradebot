import type { Context } from "telegraf";
import type { SessionRepository } from "../repositories/session-repository.js";
import type { SessionModerationToggleMiddleware } from "../middleware/session-moderation-toggle-middleware.js";
import type { ProcessIncomingMessageUseCase } from "../use-cases/process-incoming-message.js";
import type { Logger } from "../utils/logger.js";
import { getTracer, setSpanAttributes, withSpan } from "../utils/telemetry.js";

const chatAutomationTracer = getTracer("chat_automation");

/**
 * Bot API path for messages tied to a user's account via Business / Chat Automation.
 * Telegram delivers `business_message` with `business_connection_id`; we resolve the
 * owning user and require a matching onboarded row in `sessions` (from /start onboarding).
 * Onboarding registers the account + session string; business automation links the bot
 * to that user's inbox so we can read and reply to incoming DMs.
 */
type AutomationMessageShape = {
  message_id: number;
  chat: { id: number; type?: string };
  from?: { id: number; is_bot?: boolean; username?: string };
  text?: string;
  business_connection_id?: string;
};

function extractAutomationMessage(update: Record<string, unknown>): AutomationMessageShape | undefined {
  const bm = update.business_message as AutomationMessageShape | undefined;
  if (bm && typeof bm.business_connection_id === "string" && bm.business_connection_id.length > 0) {
    return bm;
  }
  const m = update.message as AutomationMessageShape | undefined;
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
   * @returns true if this update was handled here (do not run normal bot text/onboarding handlers)
   */
  async tryHandle(ctx: Context): Promise<boolean> {
    const msg = extractAutomationMessage(ctx.update as unknown as Record<string, unknown>);
    if (!msg) return false;

    if (msg.chat.type && msg.chat.type !== "private") return false;
    const from = msg.from;
    if (!from || from.is_bot) return false;

    const bcId = msg.business_connection_id;
    if (!bcId) return false;

    return withSpan(
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
            error: String(error)
          });
          return true;
        }

        const enabled = await this.sessionModeration.isEnabled(ownerUserId);
        if (!enabled) return true;

        const record = await withSpan(
          chatAutomationTracer,
          "chat_automation.resolve_session",
          async () => this.sessions.findByUserId(ownerUserId)
        );
        if (!record?.active || !record.sessionString.trim()) {
          this.logger.warn("chat_automation_no_onboarded_session", {
            ownerUserId,
            hint: "User must complete /start onboarding before business automation is moderated"
          });
          return true;
        }

        const text =
          typeof msg.text === "string" && msg.text.trim().length > 0 ? msg.text : "[non-text message]";
        const senderUsername =
          typeof from.username === "string" && from.username.length > 0 ? from.username : undefined;

        try {
          await this.processIncoming.execute({
            sessionId: ownerUserId,
            chatId: String(msg.chat.id),
            senderId: String(from.id),
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
          this.logger.error("chat_automation_process_failed", { ownerUserId, error: String(error) });
        }
        return true;
      }
    );
  }
}
