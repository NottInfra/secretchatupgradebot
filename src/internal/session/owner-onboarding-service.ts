import type { AccessPending, OnboardingStep, SessionProvider } from "@sessionprovider/sdk";
import { isOnboardingStep, messageFromOwnerNotification } from "@sessionprovider/sdk";
import type { IClientNotifications } from "../notifications/ports/client-notifications.port.js";
import type { Logger } from "../lib/logger.js";
import { pollOnboardingUntilComplete } from "./owner-onboarding-poller.js";

const ONBOARDING_TIMEOUT_MS = 15 * 60_000;

export class OwnerOnboardingService {
  constructor(
    private readonly provider: SessionProvider,
    private readonly svcName: string,
    private readonly notifications: IClientNotifications,
    private readonly logger: Logger
  ) {}

  async onboardOwner(
    ownerTelegramId: string,
    phone: string
  ): Promise<Extract<OnboardingStep, { step: "complete" }> | undefined> {
    return this.runOnboarding(ownerTelegramId, phone, false);
  }

  async reonboardOwner(
    ownerTelegramId: string,
    phone: string
  ): Promise<Extract<OnboardingStep, { step: "complete" }> | undefined> {
    return this.runOnboarding(ownerTelegramId, phone, true);
  }

  private async runOnboarding(
    ownerTelegramId: string,
    phone: string,
    forceReauth: boolean
  ): Promise<Extract<OnboardingStep, { step: "complete" }> | undefined> {
    const step = forceReauth
      ? await this.provider.restartOnboarding({
          phone,
          svcName: this.svcName,
          notifyTarget: ownerTelegramId
        })
      : await this.provider.startOnboarding({
          phone,
          svcName: this.svcName,
          notifyTarget: ownerTelegramId
        });

    if (!isOnboardingStep(step)) {
      this.logger.error("owner_onboard_invalid_step", { ownerTelegramId });
      return undefined;
    }

    if (step.step === "complete") {
      if (forceReauth) {
        this.logger.warn("owner_onboard_still_complete_after_reauth", {
          ownerTelegramId,
          accountId: step.accountId
        });
      } else {
        this.logger.info("owner_onboard_already_complete", {
          ownerTelegramId,
          accountId: step.accountId
        });
      }
      return step;
    }

    const completed = await pollOnboardingUntilComplete(
      this.provider,
      this.notifications,
      this.logger,
      ownerTelegramId,
      step,
      Date.now() + ONBOARDING_TIMEOUT_MS
    );
    if (!completed) return undefined;

    this.logger.info("owner_onboard_complete", { ownerTelegramId, accountId: completed.accountId });
    await this.notifications.sendToClient(
      ownerTelegramId,
      "Telegram session connected. We can now block contacts on your account when needed."
    );
    return completed;
  }

  async notifyAccessPending(ownerTelegramId: string, pending: AccessPending): Promise<void> {
    if (!pending.ownerNotification) {
      await this.notifications.sendToClient(
        ownerTelegramId,
        "Session access needs your approval in Telegram before we can block contacts."
      );
      return;
    }

    const message = messageFromOwnerNotification(pending.ownerNotification);
    const approve = message.replyMarkup?.inline_keyboard[0]?.find((b) => /approve/i.test(b.text));
    if (approve) {
      await this.notifications.sendHTMLWithInlineButton(
        ownerTelegramId,
        message.text,
        approve.text,
        approve.callback_data
      );
      return;
    }
    await this.notifications.sendToClient(ownerTelegramId, message.text);
  }
}
