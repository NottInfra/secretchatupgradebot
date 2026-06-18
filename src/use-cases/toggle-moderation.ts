import type { SessionRepository } from "../repositories/session-repository.js";
import type { ClientNotificationService } from "../services/client-notification-service.js";
import type { Analytics } from "../utils/analytics.js";
import type { Logger } from "../utils/logger.js";

export class ToggleModerationUseCase {
  constructor(
    private readonly sessions: SessionRepository,
    private readonly notifications: ClientNotificationService,
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
