import { describe, expect, it, vi } from "vitest";
import { BlockOnboardingCoordinator } from "./block-onboarding-coordinator.js";
import { mockLogger, sampleMessage } from "../../test/support/mocks.js";

const block = {
  senderId: "sender-1",
  decision: { action: "block" as const, confidence: 1, reason: "spam" },
  blockMessageHtml: "<b>Blocked</b>",
  moderationIncoming: sampleMessage()
};

function buildCoordinator(overrides: {
  client?: object | null;
  execute?: ReturnType<typeof vi.fn>;
} = {}) {
  const logger = mockLogger();
  const notifications = {
    sendToClient: vi.fn(async () => undefined),
    sendHTML: vi.fn(async () => undefined)
  };
  const ownerSessions = {
    getTdlibForOwner: vi.fn(async () => overrides.client ?? null)
  };
  const executeModerationAction = {
    execute: overrides.execute ?? vi.fn(async () => undefined)
  };
  const coordinator = new BlockOnboardingCoordinator(
    ownerSessions as never,
    executeModerationAction as never,
    notifications as never,
    logger as never
  );
  return { coordinator, ownerSessions, executeModerationAction, notifications, logger };
}

describe("BlockOnboardingCoordinator", () => {
  it("tracks awaiting phone state", async () => {
    const { coordinator, notifications } = buildCoordinator();
    expect(coordinator.isAwaitingPhone("owner-1")).toBe(false);

    await coordinator.requestPhoneForBlock("owner-1", block, "@sender");
    expect(coordinator.isAwaitingPhone("owner-1")).toBe(true);
    expect(notifications.sendHTML).toHaveBeenCalledOnce();
  });

  it("queues additional blocks while phone is pending", async () => {
    const { coordinator, notifications } = buildCoordinator();
    await coordinator.requestPhoneForBlock("owner-1", block, "@sender");
    await coordinator.requestPhoneForBlock("owner-1", { ...block, senderId: "sender-2" }, "@sender2");

    expect(notifications.sendHTML).toHaveBeenCalledOnce();
    await coordinator.onPhoneSubmitted("owner-1", "+447700900123");
    expect(coordinator.isAwaitingPhone("owner-1")).toBe(false);
  });

  it("ignores phone submission when not awaiting", async () => {
    const { coordinator, ownerSessions } = buildCoordinator();
    await coordinator.onPhoneSubmitted("owner-1", "+447700900123");
    expect(ownerSessions.getTdlibForOwner).not.toHaveBeenCalled();
  });

  it("runs deferred blocks after onboarding succeeds", async () => {
    const client = { invoke: vi.fn() };
    const execute = vi.fn(async () => undefined);
    const { coordinator, executeModerationAction, notifications } = buildCoordinator({
      client,
      execute
    });

    await coordinator.requestPhoneForBlock("owner-1", block, "@sender");
    await coordinator.onPhoneSubmitted("owner-1", "+447700900123");

    expect(notifications.sendToClient).toHaveBeenCalledWith("owner-1", "Connecting your Telegram session…");
    expect(executeModerationAction.execute).toHaveBeenCalledWith(client, block);
  });

  it("notifies owner when onboarding fails", async () => {
    const { coordinator, notifications } = buildCoordinator({ client: null });
    await coordinator.requestPhoneForBlock("owner-1", block, "@sender");
    await coordinator.onPhoneSubmitted("owner-1", "+447700900123");

    expect(notifications.sendToClient).toHaveBeenLastCalledWith(
      "owner-1",
      expect.stringContaining("Could not connect your Telegram session")
    );
  });

  it("executes immediately when session already exists", async () => {
    const client = { invoke: vi.fn() };
    const execute = vi.fn(async () => undefined);
    const { coordinator, executeModerationAction } = buildCoordinator({ client, execute });

    const executed = await coordinator.executeBlockWithSession("owner-1", block, "@sender");
    expect(executed).toBe(true);
    expect(executeModerationAction.execute).toHaveBeenCalledWith(client, block);
  });

  it("starts phone onboarding when session is missing", async () => {
    const { coordinator, notifications } = buildCoordinator({ client: null });
    const executed = await coordinator.executeBlockWithSession("owner-1", block, "@sender");

    expect(executed).toBe(false);
    expect(coordinator.isAwaitingPhone("owner-1")).toBe(true);
    expect(notifications.sendHTML).toHaveBeenCalledWith(
      "owner-1",
      expect.stringContaining("Send your phone number")
    );
  });
});
