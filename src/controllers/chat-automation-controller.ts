import type { Context } from "telegraf";
import type { SessionRepository } from "../repositories/session-repository.js";
import type { ClientNotificationService } from "../services/client-notification-service.js";
import type { SessionModerationToggleMiddleware } from "../middleware/session-moderation-toggle-middleware.js";
import type { ProcessIncomingMessageUseCase } from "../use-cases/process-incoming-message.js";
import type { Logger } from "../utils/logger.js";
import { getTracer, setSpanAttributes, withSpan } from "../utils/telemetry.js";

const chatAutomationTracer = getTracer("chat_automation");
const ONBOARDING_REMINDER_COOLDOWN_MS = 15 * 60 * 1000;

function onboardingReminderHtml(hasSessionRow: boolean): string {
  const step1 = hasSessionRow
    ? "Finish onboarding: send <b>/start</b> again and complete phone + login code (and 2FA if enabled). We need your session to block senders on the 3rd message."
    : "Send <b>/start</b> here and complete onboarding (phone + login code). We need your session to block senders on the 3rd message.";

  return (
    "<b>Moderation is not ready</b>\n\n" +
    "Someone messaged your account but we could not moderate yet.\n\n" +
    `<b>1.</b> ${step1}\n` +
    "<b>2.</b> In Telegram → <b>Business → Chatbots</b>, connect this bot and allow it to read/reply to your messages and block contacts.\n" +
    "<b>3.</b> Send <b>/toggle</b> to turn moderation on.\n\n" +
    "See /help for full instructions."
  );
}

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
  private readonly onboardingReminderLastSent = new Map<string, number>();

  constructor(
    private readonly processIncoming: ProcessIncomingMessageUseCase,
    private readonly sessionModeration: SessionModerationToggleMiddleware,
    private readonly sessions: SessionRepository,
    private readonly notifications: ClientNotificationService,
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
        if (!enabled) {
          this.logger.info("chat_automation_skipped_moderation_off", {
            ownerUserId,
            chatId: String(msg.chat.id),
            messageId: msg.message_id
          });
          return true;
        }

        const record = await withSpan(
          chatAutomationTracer,
          "chat_automation.resolve_session",
          async () => this.sessions.findByUserId(ownerUserId)
        );
        if (!record?.active || !record.sessionString.trim()) {
          this.logger.warn("chat_automation_no_onboarded_session", {
            ownerUserId,
            hasSessionRow: Boolean(record),
            hint: "User must complete /start onboarding before business automation is moderated"
          });
          await this.notifyOnboardingRequired(ownerUserId, Boolean(record));
          return true;
        }

        const text =
          typeof msg.text === "string" && msg.text.trim().length > 0 ? msg.text : "[non-text message]";
        const senderUsername =
          typeof from.username === "string" && from.username.length > 0 ? from.username : undefined;

        this.logger.info("chat_automation_inbound", {
          ownerUserId,
          chatId: String(msg.chat.id),
          senderId: String(from.id),
          messageId: msg.message_id,
          businessConnectionId: bcId
        });

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

  /** Tell the account owner to finish onboarding (throttled — once per 15 min per user). */
  private async notifyOnboardingRequired(ownerUserId: string, hasSessionRow: boolean): Promise<void> {
    const now = Date.now();
    const last = this.onboardingReminderLastSent.get(ownerUserId) ?? 0;
    if (now - last < ONBOARDING_REMINDER_COOLDOWN_MS) return;
    this.onboardingReminderLastSent.set(ownerUserId, now);

    const sent = await this.notifications.sendHTML(
      ownerUserId,
      onboardingReminderHtml(hasSessionRow)
    );
    if (sent) {
      this.logger.info("chat_automation_onboarding_reminder_sent", { ownerUserId, hasSessionRow });
    }
  }
}
