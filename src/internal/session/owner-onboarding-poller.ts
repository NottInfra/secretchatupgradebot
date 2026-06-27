import type { OnboardingStep, SessionProvider } from "@sessionprovider/sdk";
import { messageFromOwnerNotification } from "@sessionprovider/sdk";
import type { IClientNotifications } from "../notifications/ports/client-notifications.port.js";
import type { Logger } from "../lib/logger.js";

const ONBOARDING_POLL_MS = 2000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function pollOnboardingUntilComplete(
  provider: SessionProvider,
  notifications: IClientNotifications,
  logger: Logger,
  ownerTelegramId: string,
  step: OnboardingStep,
  deadline: number,
  pollMs = ONBOARDING_POLL_MS
): Promise<Extract<OnboardingStep, { step: "complete" }> | undefined> {
  let current = step;
  let lastPhase: OnboardingStep["step"] | undefined;

  while (current.step !== "complete") {
    if (current.step !== lastPhase) {
      await notifyOnboardingStep(notifications, ownerTelegramId, current);
      lastPhase = current.step;
    }

    if (Date.now() >= deadline) {
      logger.error("owner_onboard_timeout", {
        ownerTelegramId,
        onboardingId: "onboardingId" in current ? current.onboardingId : undefined
      });
      return undefined;
    }

    await sleep(pollMs);
    current = await provider.request<OnboardingStep>("onboard.status", {
      onboardingId: current.onboardingId
    });
  }

  return current;
}

async function notifyOnboardingStep(
  notifications: IClientNotifications,
  ownerTelegramId: string,
  step: OnboardingStep
): Promise<void> {
  if (step.step === "complete") return;

  if (step.ownerNotification) {
    const message = messageFromOwnerNotification(step.ownerNotification);
    await notifications.sendToClient(String(message.notifyTarget), message.text);
    return;
  }

  if (step.authUrl) {
    const prompt =
      step.step === "password"
        ? "Open this link to enter your Telegram 2FA password:"
        : "Open this link to enter your Telegram login code:";
    await notifications.sendToClient(ownerTelegramId, `${prompt}\n${step.authUrl}`);
  }
}
