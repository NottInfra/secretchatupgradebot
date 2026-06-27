import { describe, expect, it, vi } from "vitest";
import { BotRoutes } from "./bot.js";

vi.mock("../../lib/telemetry.js", () => ({
  getTracer: () => ({}),
  setSpanAttributes: () => undefined,
  withSpan: async (_t: unknown, _n: string, fn: () => Promise<unknown>) => fn()
}));

describe("BotRoutes", () => {
  it("registers middleware and event handlers", () => {
    const use = vi.fn();
    const on = vi.fn();
    const command = vi.fn();
    const telegraf = { use, on, command, action: vi.fn(), catch: vi.fn() };
    const routes = new BotRoutes(telegraf as never, {
      controller: {
        handleStart: vi.fn(),
        handleToggleOnOff: vi.fn(),
        handleConnect: vi.fn(),
        handleText: vi.fn()
      } as never,
      chatAutomation: { tryHandle: async () => false } as never,
      handleOwnerBlockCallback: { execute: async () => {} } as never,
      handleUserMiddleware: { run: async (_ctx: unknown, next: () => Promise<void>) => next() } as never,
      handlePolicyUseCase: { execute: async () => {} } as never
    });
    routes.bind();
    expect(use).toHaveBeenCalled();
    expect(on).toHaveBeenCalled();
  });
});
