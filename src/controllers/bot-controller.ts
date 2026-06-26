import path from "node:path";
import type { ClientNotificationService } from "../services/client-notification-service.js";
import type { BlockOnboardingCoordinator } from "../services/session-provider/block-onboarding-coordinator.js";
import type { Logger } from "../utils/logger.js";
import type { ToggleModerationUseCase } from "../use-cases/toggle-moderation.js";

export class BotController {
  constructor(
    private readonly blockOnboarding: BlockOnboardingCoordinator,
    private readonly toggleModeration: ToggleModerationUseCase,
    private readonly notifications: ClientNotificationService,
    private readonly logger: Logger
  ) {}

  async handleStart(userId: number): Promise<void> {
    await this.guard(
      async () => {
        await this.notifications.sendHTMLFile(String(userId), path.resolve("assets/policies/start.html"));
        if (this.blockOnboarding.isAwaitingPhone(String(userId))) {
          await this.notifications.sendToClient(
            String(userId),
            "Your session connection is still in progress — send your phone number or complete the login link above."
          );
        }
      },
      async () => {
        await this.notifications.sendToClient(String(userId), "command failed");
      }
    );
  }

  async handleConnect(userId: number): Promise<void> {
    await this.guard(
      async () => {
        await this.blockOnboarding.requestSessionConnect(String(userId));
      },
      async () => {
        await this.notifications.sendToClient(String(userId), "Could not start session connection. Try again.");
      }
    );
  }

  async handleText(userId: number, text: string): Promise<void> {
    if (!this.blockOnboarding.isAwaitingPhone(String(userId))) return;

    await this.guard(
      async () => {
        await this.blockOnboarding.onPhoneSubmitted(String(userId), text.trim());
      },
      async () => {
        await this.notifications.sendToClient(String(userId), "Could not use that phone number. Try again.");
      }
    );
  }

  async handleToggleOnOff(userId: number): Promise<void> {
    await this.guard(
      async () => {
        await this.toggleModeration.execute(userId);
      },
      async () => {
        await this.notifications.sendToClient(String(userId), "toggle failed");
      }
    );
  }

  private async guard(next: () => Promise<void>, onErrorReply: () => Promise<void>): Promise<void> {
    try {
      await next();
    } catch (error) {
      this.logger.error("bot_command_failed", { error: String(error) });
      await onErrorReply();
    }
  }
}
