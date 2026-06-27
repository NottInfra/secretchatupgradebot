import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockLogger } from "../test/support/mocks.js";

const telegrafState = vi.hoisted(() => ({
  catchHandler: undefined as ((error: unknown, ctx: { update: { update_id: number } }) => void) | undefined,
  getMe: vi.fn(async () => ({ username: "bot", id: 42 })),
  launch: vi.fn(async () => undefined),
  stop: vi.fn()
}));

vi.mock("@opentelemetry/api", () => ({
  context: { with: (_ctx: unknown, fn: () => void) => fn() },
  ROOT_CONTEXT: {}
}));

vi.mock("telegraf", () => ({
  Telegraf: class MockTelegraf {
    telegram = { getMe: telegrafState.getMe };
    constructor(_token: string) {}
    catch(handler: (error: unknown, ctx: { update: { update_id: number } }) => void) {
      telegrafState.catchHandler = handler;
    }
    launch = telegrafState.launch;
    stop = telegrafState.stop;
  }
}));

import { MgmtBotService } from "./mgmt-bot-service.js";

describe("MgmtBotService", () => {
  beforeEach(() => {
    telegrafState.getMe.mockClear();
    telegrafState.launch.mockClear();
    telegrafState.stop.mockClear();
    telegrafState.catchHandler = undefined;
  });

  it("warns and exits when the token is missing", async () => {
    const logger = mockLogger();
    const service = new MgmtBotService(undefined, vi.fn(), { attachBot: vi.fn() } as never, logger as never);
    await service.start();
    expect(logger.warn).toHaveBeenCalledWith("mgmt_bot_not_started_missing_token");
    expect(telegrafState.getMe).not.toHaveBeenCalled();
  });

  it("starts polling and logs identity on success", async () => {
    const logger = mockLogger();
    const bindRoutes = vi.fn();
    const service = new MgmtBotService("token", bindRoutes, { attachBot: vi.fn() } as never, logger as never);
    await service.start();
    expect(bindRoutes).toHaveBeenCalledOnce();
    expect(telegrafState.getMe).toHaveBeenCalledOnce();
    expect(telegrafState.launch).toHaveBeenCalledOnce();
    expect(logger.info).toHaveBeenCalledWith("mgmt_bot_identity_ok", { username: "bot", id: 42 });
  });

  it("logs update failures via bot.catch without rethrowing", async () => {
    const logger = mockLogger();
    const service = new MgmtBotService("token", vi.fn(), { attachBot: vi.fn() } as never, logger as never);
    await service.start();
    telegrafState.catchHandler?.(new Error("handler failed"), { update: { update_id: 7 } });
    expect(logger.error).toHaveBeenCalledWith(
      "mgmt_bot_update_failed",
      expect.objectContaining({ updateId: 7, error: "handler failed" })
    );
  });

  it("logs launch failures from getMe", async () => {
    const logger = mockLogger();
    telegrafState.getMe.mockRejectedValueOnce(new Error("bad token"));
    const service = new MgmtBotService("token", vi.fn(), { attachBot: vi.fn() } as never, logger as never);
    await service.start();
    expect(logger.error).toHaveBeenCalledWith("mgmt_bot_launch_failed", { error: "bad token" });
  });

  it("logs async launch failures", async () => {
    const logger = mockLogger();
    telegrafState.launch.mockRejectedValueOnce(new Error("polling stopped"));
    const service = new MgmtBotService("token", vi.fn(), { attachBot: vi.fn() } as never, logger as never);
    await service.start();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(logger.error).toHaveBeenCalledWith("mgmt_bot_launch_failed", { error: "polling stopped" });
  });

  it("stops the bot when running", async () => {
    const service = new MgmtBotService("token", vi.fn(), { attachBot: vi.fn() } as never, mockLogger() as never);
    await service.start();
    await service.stop();
    expect(telegrafState.stop).toHaveBeenCalledOnce();
  });
});
