import type { IStore } from "../../lib/db/store.js";
import type { Analytics } from "../../lib/analytics.js";
import { getTracer, setSpanAttributes, withSpan } from "../../lib/telemetry.js";

const userTracer = getTracer("user");

export type TelegramUser = {
  telegramId: number;
  username: string;
  firstName: string;
  lastName: string;
};

export class HandleUserMiddleware {
  constructor(
    private readonly store: IStore,
    private readonly analytics?: Analytics
  ) {}

  async ensureUser(user: TelegramUser, chatId: number): Promise<void> {
    return withSpan(userTracer, "user.ensure", async (span) => {
      setSpanAttributes(span, { "telegram.user_id": user.telegramId, "telegram.chat_id": chatId });
    if (user.telegramId === 0) {
      this.analytics?.trackEvent("user_ensure_rejected", {
        status: "invalid",
        reason: "zero_telegram_id",
        chatId
      });
      throw new Error("invalid_telegram_user");
    }

    const now = new Date().toISOString();
    await this.store.write(
      "users.upsert",
      user.telegramId,
      user.username,
      user.firstName,
      user.lastName,
      now
    );
    setSpanAttributes(span, { "user.status": "ok" });
    });
  }
}
