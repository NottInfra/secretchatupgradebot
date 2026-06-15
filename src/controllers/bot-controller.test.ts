import { describe, expect, it, vi } from "vitest";
import { BotController } from "./bot-controller.js";
import { mockLogger } from "../test/support/mocks.js";

describe("BotController", () => {
  it("delegates /start to onboarding", async () => {
    const onboarding = { onStart: vi.fn(async () => undefined) };
    const controller = new BotController(
      onboarding as never,
      {} as never,
      { sendToClient: vi.fn() } as never,
      mockLogger() as never
    );

    await controller.handleStart(9);
    expect(onboarding.onStart).toHaveBeenCalledWith(9);
  });

  it("replies when command handling fails", async () => {
    const notifications = { sendToClient: vi.fn(async () => true) };
    const controller = new BotController(
      { onStart: vi.fn(async () => { throw new Error("fail"); }) } as never,
      {} as never,
      notifications as never,
      mockLogger() as never
    );

    await controller.handleStart(9);
    expect(notifications.sendToClient).toHaveBeenCalledWith("9", "command failed");
  });
});
