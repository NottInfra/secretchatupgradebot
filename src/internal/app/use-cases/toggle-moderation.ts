import type { ISessionRepository } from "../../session/ports/session-repository.port.js";
import type { IClientNotifications } from "../../notifications/ports/client-notifications.port.js";
import type { Analytics } from "../../lib/analytics.js";
import type { Logger } from "../../lib/logger.js";

export class ToggleModerationUseCase {
  constructor(
    private readonly sessions: ISessionRepository,
    private readonly notifications: IClientNotifications,
    private readonly analytics: Analytics,
    private readonly logger: Logger
  ) {}

  async execute(userId: number): Promise<void> {
    const userIdStr = String(userId);
    let record = await this.sessions.findByUserId(userIdStr);
    if (!record) {
      await this.sessions.ensureUser(userIdStr);
      record = await this.sessions.findByUserId(userIdStr);
    }

    const nextActive = !(record?.active ?? false);
    await this.sessions.setActive(userIdStr, nextActive);
    this.analytics.trackEvent("moderation_toggled", { userId, active: nextActive });
    this.logger.info("moderation_toggled", { userId, active: nextActive });
    await this.notifications.sendToClient(
      String(userId),
      nextActive
        ? "Moderation is now ON. We will warn and block senders via business automation; your Telegram session is only requested when a block is needed."
        : "Moderation is now OFF."
    );
  }
}
