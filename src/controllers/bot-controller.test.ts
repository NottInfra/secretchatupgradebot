import { describe, expect, it, vi } from "vitest";
import { BotController } from "./bot-controller.js";
import { mockLogger } from "../test/support/mocks.js";

describe("BotController", () => {
  it("sends start policy on /start", async () => {
    const notifications = { sendHTMLFile: vi.fn(async () => true) };
    const controller = new BotController(
      { isAwaitingPhone: vi.fn(() => false) } as never,
      {} as never,
      notifications as never,
      mockLogger() as never
    );

    await controller.handleStart(9);
    expect(notifications.sendHTMLFile).toHaveBeenCalledWith("9", expect.stringContaining("start.html"));
  });

  it("replies when command handling fails", async () => {
    const notifications = { sendToClient: vi.fn(async () => true), sendHTMLFile: vi.fn(async () => { throw new Error("fail"); }) };
    const controller = new BotController(
      { isAwaitingPhone: vi.fn(() => false) } as never,
      {} as never,
      notifications as never,
      mockLogger() as never
    );

    await controller.handleStart(9);
    expect(notifications.sendToClient).toHaveBeenCalledWith("9", "command failed");
  });
});
