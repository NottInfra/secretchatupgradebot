import { describe, expect, it, vi } from "vitest";
import { ToggleModerationUseCase } from "./toggle-moderation.js";
import { mockAnalytics, mockLogger } from "../test/support/mocks.js";

describe("ToggleModerationUseCase", () => {
  it("prompts onboarding when no session exists", async () => {
    const notifications = { sendToClient: vi.fn(async () => true) };
    const useCase = new ToggleModerationUseCase(
      { findByUserId: async () => undefined } as never,
      notifications as never,
      mockAnalytics() as never,
      mockLogger() as never
    );

    await useCase.execute(42);
    expect(notifications.sendToClient).toHaveBeenCalledWith(
      "42",
      "No active onboarding session found. Send /start first."
    );
  });

  it("toggles moderation on and off", async () => {
    const notifications = { sendToClient: vi.fn(async () => true) };
    const setActive = vi.fn(async () => undefined);
    const useCase = new ToggleModerationUseCase(
      {
        findByUserId: async () => ({ userId: "42", sessionString: "s", active: true }),
        setActive
      } as never,
      notifications as never,
      mockAnalytics() as never,
      mockLogger() as never
    );

    await useCase.execute(42);
    expect(setActive).toHaveBeenCalledWith("42", false);
    expect(notifications.sendToClient).toHaveBeenCalledWith("42", "Moderation is now OFF.");
  });
});
