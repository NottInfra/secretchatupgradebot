import { describe, expect, it, vi } from "vitest";
import type { Context } from "telegraf";
import { BotRoutes } from "./bot.js";

vi.mock("../../lib/telemetry.js", () => ({
  getTracer: () => ({}),
  setSpanAttributes: () => undefined,
  withSpan: async (_t: unknown, _n: string, fn: () => Promise<unknown>) => fn()
}));

type Handler = (ctx: Context, next?: () => Promise<void>) => Promise<void>;

function buildRoutes(overrides: Partial<{
  controller: object;
  chatAutomation: object;
  handleOwnerBlockCallback: object;
  handleUserMiddleware: object;
  handlePolicyUseCase: object;
}> = {}) {
  const handlers = {
    use: [] as Handler[],
    text: [] as Handler[],
    callback: [] as Handler[]
  };

  const telegraf = {
    use: vi.fn((handler: Handler) => {
      handlers.use.push(handler);
    }),
    on: vi.fn((event: string, handler: Handler) => {
      if (event === "text") handlers.text.push(handler);
      if (event === "callback_query") handlers.callback.push(handler);
    }),
    command: vi.fn(),
    action: vi.fn(),
    catch: vi.fn()
  };

  const deps = {
    controller: {
      handleStart: vi.fn(),
      handleToggleOnOff: vi.fn(),
      handleConnect: vi.fn(),
      handleText: vi.fn(),
      ...overrides.controller
    },
    chatAutomation: {
      tryHandle: vi.fn(async () => false),
      ...overrides.chatAutomation
    },
    handleOwnerBlockCallback: {
      execute: vi.fn(async () => "blocked"),
      ...overrides.handleOwnerBlockCallback
    },
    handleUserMiddleware: {
      ensureUser: vi.fn(async () => undefined),
      ...overrides.handleUserMiddleware
    },
    handlePolicyUseCase: {
      execute: vi.fn(async () => undefined),
      ...overrides.handlePolicyUseCase
    }
  };

  const routes = new BotRoutes(telegraf as never, deps as never);
  routes.bind();

  return { handlers, deps, telegraf };
}

function textCtx(text: string, overrides: Partial<Context> = {}): Context {
  return {
    from: { id: 42, username: "alice", first_name: "Alice", last_name: "Test" },
    chat: { id: 99, type: "private" },
    message: { text },
    answerCbQuery: vi.fn(async () => true),
    ...overrides
  } as unknown as Context;
}

describe("BotRoutes", () => {
  it("registers middleware and event handlers", () => {
    const { telegraf } = buildRoutes();
    expect(telegraf.use).toHaveBeenCalled();
    expect(telegraf.on).toHaveBeenCalled();
  });

  it("short-circuits middleware when automation handles the update", async () => {
    const { handlers, deps } = buildRoutes({
      chatAutomation: { tryHandle: vi.fn(async () => true) }
    });
    const next = vi.fn(async () => undefined);
    const ctx = textCtx("hello");

    await handlers.use[0](ctx, next);

    expect(deps.chatAutomation.tryHandle).toHaveBeenCalledWith(ctx);
    expect(next).not.toHaveBeenCalled();
  });

  it("continues middleware when automation does not handle the update", async () => {
    const { handlers } = buildRoutes();
    const next = vi.fn(async () => undefined);

    await handlers.use[0](textCtx("hello"), next);

    expect(next).toHaveBeenCalled();
  });

  it("handles owner block callbacks", async () => {
    const { handlers, deps } = buildRoutes({
      handleOwnerBlockCallback: { execute: vi.fn(async () => "Sender blocked on your account.") }
    });
    const ctx = {
      from: { id: 42 },
      callbackQuery: { data: "owner_block:token-1" },
      answerCbQuery: vi.fn(async () => true)
    } as unknown as Context;

    await handlers.callback[0](ctx);

    expect(deps.handleOwnerBlockCallback.execute).toHaveBeenCalledWith(42, "token-1");
    expect(ctx.answerCbQuery).toHaveBeenCalledWith("Sender blocked on your account.");
  });

  it("truncates long owner block callback alerts", async () => {
    const { handlers } = buildRoutes({
      handleOwnerBlockCallback: { execute: vi.fn(async () => "x".repeat(250)) }
    });
    const ctx = {
      from: { id: 42 },
      callbackQuery: { data: "owner_block:token-1" },
      answerCbQuery: vi.fn(async () => true)
    } as unknown as Context;

    await handlers.callback[0](ctx);

    expect(ctx.answerCbQuery).toHaveBeenCalledWith("x".repeat(200), { show_alert: true });
  });

  it("ignores unrelated callback queries", async () => {
    const { handlers, deps } = buildRoutes();
    const ctx = {
      from: { id: 42 },
      callbackQuery: { data: "other:token" },
      answerCbQuery: vi.fn(async () => true)
    } as unknown as Context;

    await handlers.callback[0](ctx);

    expect(deps.handleOwnerBlockCallback.execute).not.toHaveBeenCalled();
    expect(ctx.answerCbQuery).not.toHaveBeenCalled();
  });

  it("routes slash commands through policy and controller handlers", async () => {
    const { handlers, deps } = buildRoutes();

    await handlers.text[0](textCtx("/help"));
    expect(deps.handleUserMiddleware.ensureUser).toHaveBeenCalled();
    expect(deps.handlePolicyUseCase.execute).toHaveBeenCalledWith(42, "/help");

    await handlers.text[0](textCtx("/start"));
    expect(deps.controller.handleStart).toHaveBeenCalledWith(42);

    await handlers.text[0](textCtx("/toggle"));
    expect(deps.controller.handleToggleOnOff).toHaveBeenCalledWith(42);

    await handlers.text[0](textCtx("/connect"));
    expect(deps.controller.handleConnect).toHaveBeenCalledWith(42);
  });

  it("ignores unknown slash commands", async () => {
    const { handlers, deps } = buildRoutes();

    await handlers.text[0](textCtx("/unknown"));

    expect(deps.handlePolicyUseCase.execute).not.toHaveBeenCalled();
    expect(deps.controller.handleStart).not.toHaveBeenCalled();
  });

  it("forwards plain text to the controller", async () => {
    const { handlers, deps } = buildRoutes();

    await handlers.text[0](textCtx("hello there"));

    expect(deps.controller.handleText).toHaveBeenCalledWith(42, "hello there");
  });

  it("ignores text updates without a sender", async () => {
    const { handlers, deps } = buildRoutes();

    await handlers.text[0]({
      message: { text: "hello" }
    } as Context);

    expect(deps.handleUserMiddleware.ensureUser).not.toHaveBeenCalled();
    expect(deps.controller.handleText).not.toHaveBeenCalled();
  });
});
