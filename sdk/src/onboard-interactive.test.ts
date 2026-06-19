import { describe, expect, it, vi } from "vitest";
import { runOnboardingInteractive } from "./onboard-interactive.js";
import type { Account, OnboardingStep } from "./types.js";

const account: Account = {
  id: "a1",
  telegramId: 1,
  phone: "+441234567890",
  username: "alice",
  firstName: "Alice",
  lastName: "Test",
  bio: "",
  managedSessionCount: 0,
  activeTelegramSessionCount: null,
  poolEnabled: false,
  sessions: [{ id: "s1", accountId: "a1", svcName: "svc", name: "svc", sessionPath: "p", sessionDirs: { databaseDirectory: "d", filesDirectory: "f" } }]
};

describe("runOnboardingInteractive", () => {
  it("returns immediately when start resolves an existing account", async () => {
    const result = await runOnboardingInteractive(
      { ask: vi.fn().mockResolvedValue("+441234567890") },
      vi.fn().mockResolvedValue(account),
      vi.fn()
    );
    expect(result).toEqual({ step: "complete", accountId: "a1", sessionId: "s1" });
  });

  it("prompts for code then completes onboarding", async () => {
    const tell = vi.fn();
    const submit = vi.fn().mockResolvedValue({ step: "complete", accountId: "a1", sessionId: "s1" });

    const result = await runOnboardingInteractive(
      {
        ask: vi.fn().mockResolvedValueOnce("+441234567890").mockResolvedValueOnce("12345"),
        tell
      },
      vi.fn().mockResolvedValue({ step: "code", onboardingId: "onb-1", authUrl: "https://auth.test/code" }),
      submit
    );

    expect(result).toEqual({ step: "complete", accountId: "a1", sessionId: "s1" });
    expect(tell).toHaveBeenCalledWith(expect.stringContaining("auth page"));
    expect(submit).toHaveBeenCalledWith("onb-1", "code", "12345");
  });

  it("prompts for password when 2FA is required", async () => {
    const submit = vi
      .fn()
      .mockResolvedValueOnce({ step: "password", onboardingId: "onb-1", authUrl: "https://auth.test/password" })
      .mockResolvedValueOnce({ step: "complete", accountId: "a1", sessionId: "s1" });

    const result = await runOnboardingInteractive(
      {
        ask: vi
          .fn()
          .mockResolvedValueOnce("+441234567890")
          .mockResolvedValueOnce("12345")
          .mockResolvedValueOnce("secret")
      },
      vi.fn().mockResolvedValue({ step: "code", onboardingId: "onb-1", authUrl: "https://auth.test/code" }),
      submit
    );

    expect(result.sessionId).toBe("s1");
    expect(submit).toHaveBeenLastCalledWith("onb-1", "password", "secret");
  });
});
