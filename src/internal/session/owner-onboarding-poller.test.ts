import { describe, expect, it, vi } from "vitest";
import { pollOnboardingUntilComplete } from "./owner-onboarding-poller.js";
import { mockLogger } from "../test/support/mocks.js";

describe("pollOnboardingUntilComplete", () => {
  it("notifies via auth url when owner notification is absent", async () => {
    const sendToClient = vi.fn(async () => true);
    const provider = {
      request: vi.fn(async () => ({ step: "complete", accountId: "a1", sessionId: "s1" }))
    };

    const result = await pollOnboardingUntilComplete(
      provider as never,
      { sendToClient } as never,
      mockLogger() as never,
      "owner-1",
      { step: "code", onboardingId: "onb-1", authUrl: "https://auth.test/code" },
      Date.now() + 60_000,
      0
    );

    expect(result).toEqual({ step: "complete", accountId: "a1", sessionId: "s1" });
    expect(sendToClient).toHaveBeenCalledWith(
      "owner-1",
      "Open this link to enter your Telegram login code:\nhttps://auth.test/code"
    );
  });

  it("uses password wording for password steps", async () => {
    const sendToClient = vi.fn(async () => true);
    const provider = {
      request: vi.fn(async () => ({ step: "complete", accountId: "a1", sessionId: "s1" }))
    };

    await pollOnboardingUntilComplete(
      provider as never,
      { sendToClient } as never,
      mockLogger() as never,
      "owner-1",
      { step: "password", onboardingId: "onb-1", authUrl: "https://auth.test/password" },
      Date.now() + 60_000,
      0
    );

    expect(sendToClient).toHaveBeenCalledWith(
      "owner-1",
      "Open this link to enter your Telegram 2FA password:\nhttps://auth.test/password"
    );
  });
});
