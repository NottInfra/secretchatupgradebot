import { describe, expect, it, vi } from "vitest";
import { ToggleModerationUseCase } from "./toggle-moderation.js";
import { mockAnalytics, mockLogger } from "../test/support/mocks.js";

describe("ToggleModerationUseCase", () => {
  it("creates a moderation row and toggles on", async () => {
    const ensureUser = vi.fn(async () => undefined);
    const setActive = vi.fn(async () => undefined);
    const findByUserId = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ userId: "42", active: false });
    const notifications = { sendToClient: vi.fn(async () => true) };
    const useCase = new ToggleModerationUseCase(
      { findByUserId, ensureUser, setActive } as never,
      notifications as never,
      mockAnalytics() as never,
      mockLogger() as never
    );

    await useCase.execute(42);

    expect(ensureUser).toHaveBeenCalledWith("42");
    expect(setActive).toHaveBeenCalledWith("42", true);
    expect(notifications.sendToClient).toHaveBeenCalledWith("42", expect.stringContaining("ON"));
  });

  it("toggles moderation off when already on", async () => {
    const setActive = vi.fn(async () => undefined);
    const notifications = { sendToClient: vi.fn(async () => true) };
    const useCase = new ToggleModerationUseCase(
      {
        findByUserId: async () => ({ userId: "42", active: true }),
        ensureUser: vi.fn(),
        setActive
      } as never,
      notifications as never,
      mockAnalytics() as never,
      mockLogger() as never
    );

    await useCase.execute(42);

    expect(setActive).toHaveBeenCalledWith("42", false);
    expect(notifications.sendToClient).toHaveBeenCalledWith("42", expect.stringContaining("OFF"));
  });
});
