import { describe, expect, it, vi } from "vitest";
import { BotController } from "./bot-controller.js";
import { mockLogger } from "../../test/support/mocks.js";

describe("BotController", () => {
  it("sends start policy on /start", async () => {
    const notifications = { sendHTMLFile: vi.fn(async () => true), sendToClient: vi.fn(async () => true) };
    const controller = new BotController(
      { isAwaitingPhone: vi.fn(() => false) } as never,
      {} as never,
      notifications as never,
      mockLogger() as never
    );

    await controller.handleStart(9);
    expect(notifications.sendHTMLFile).toHaveBeenCalledWith("9", expect.stringContaining("start.html"));
  });

  it("reminds owners to finish phone onboarding on /start", async () => {
    const notifications = { sendHTMLFile: vi.fn(async () => true), sendToClient: vi.fn(async () => true) };
    const controller = new BotController(
      { isAwaitingPhone: vi.fn(() => true) } as never,
      {} as never,
      notifications as never,
      mockLogger() as never
    );

    await controller.handleStart(9);
    expect(notifications.sendToClient).toHaveBeenCalledWith(
      "9",
      "Your session connection is still in progress — send your phone number or complete the login link above."
    );
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

  it("starts session connect flow", async () => {
    const blockOnboarding = { requestSessionConnect: vi.fn(async () => undefined) };
    const controller = new BotController(
      blockOnboarding as never,
      {} as never,
      { sendToClient: vi.fn() } as never,
      mockLogger() as never
    );

    await controller.handleConnect(9);
    expect(blockOnboarding.requestSessionConnect).toHaveBeenCalledWith("9");
  });

  it("reports connect failures to the owner", async () => {
    const notifications = { sendToClient: vi.fn(async () => true) };
    const controller = new BotController(
      { requestSessionConnect: vi.fn(async () => { throw new Error("fail"); }) } as never,
      {} as never,
      notifications as never,
      mockLogger() as never
    );

    await controller.handleConnect(9);
    expect(notifications.sendToClient).toHaveBeenCalledWith("9", "Could not start session connection. Try again.");
  });

  it("toggles moderation for the owner", async () => {
    const toggleModeration = { execute: vi.fn(async () => undefined) };
    const controller = new BotController(
      {} as never,
      toggleModeration as never,
      { sendToClient: vi.fn() } as never,
      mockLogger() as never
    );

    await controller.handleToggleOnOff(9);
    expect(toggleModeration.execute).toHaveBeenCalledWith(9);
  });

  it("forwards phone text during block onboarding", async () => {
    const blockOnboarding = {
      isAwaitingPhone: vi.fn(() => true),
      onPhoneSubmitted: vi.fn(async () => undefined)
    };
    const notifications = { sendToClient: vi.fn(async () => true) };
    const controller = new BotController(
      blockOnboarding as never,
      {} as never,
      notifications as never,
      mockLogger() as never
    );

    await controller.handleText(9, "  +447700900123 ");
    expect(blockOnboarding.onPhoneSubmitted).toHaveBeenCalledWith("9", "+447700900123");
  });

  it("reports invalid phone submissions", async () => {
    const blockOnboarding = {
      isAwaitingPhone: vi.fn(() => true),
      onPhoneSubmitted: vi.fn(async () => { throw new Error("bad phone"); })
    };
    const notifications = { sendToClient: vi.fn(async () => true) };
    const controller = new BotController(
      blockOnboarding as never,
      {} as never,
      notifications as never,
      mockLogger() as never
    );

    await controller.handleText(9, "+447700900123");
    expect(notifications.sendToClient).toHaveBeenCalledWith("9", "Could not use that phone number. Try again.");
  });

  it("ignores text when phone onboarding is not active", async () => {
    const blockOnboarding = {
      isAwaitingPhone: vi.fn(() => false),
      onPhoneSubmitted: vi.fn()
    };
    const controller = new BotController(
      blockOnboarding as never,
      {} as never,
      { sendToClient: vi.fn() } as never,
      mockLogger() as never
    );

    await controller.handleText(9, "+447700900123");
    expect(blockOnboarding.onPhoneSubmitted).not.toHaveBeenCalled();
  });
});
