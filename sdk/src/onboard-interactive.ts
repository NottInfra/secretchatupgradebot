import type { Account, OnboardingStep } from "./types.js";

export type OnboardPrompter = {
  ask: (question: string) => Promise<string>;
  tell?: (message: string) => void;
};

export function isOnboardingStep(value: unknown): value is OnboardingStep {
  return Boolean(value && typeof value === "object" && "step" in value);
}

function promptLabel(step: OnboardingStep): string {
  return step.step === "password" ? "Telegram 2FA password: " : "Telegram login code: ";
}

function announceStep(step: OnboardingStep, prompter: OnboardPrompter): void {
  if (step.step === "complete" || !step.authUrl) return;
  const message =
    step.step === "password"
      ? `2FA required — auth page:\n${step.authUrl}`
      : `Enter the login code — auth page:\n${step.authUrl}`;
  if (prompter.tell) prompter.tell(message);
  else console.log(message);
}

type CompleteOnboardingStep = Extract<OnboardingStep, { step: "complete" }>;

export async function runOnboardingInteractive(
  prompter: OnboardPrompter,
  start: (phone: string) => Promise<Account | OnboardingStep>,
  submit: (onboardingId: string, kind: "code" | "password", value: string) => Promise<OnboardingStep>
): Promise<CompleteOnboardingStep> {
  const phone = await prompter.ask("Phone number (international format, e.g. +447700900123): ");
  let step = await start(phone.trim());

  if (!isOnboardingStep(step)) {
    return { step: "complete", accountId: step.id, sessionId: step.sessions[0]?.id ?? "" };
  }

  while (step.step !== "complete") {
    announceStep(step, prompter);
    const value = await prompter.ask(promptLabel(step));
    step = await submit(step.onboardingId, step.step, value.trim());
  }

  return step;
}
