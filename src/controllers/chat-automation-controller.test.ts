import { describe, expect, it, vi } from "vitest";
import type { Context } from "telegraf";
import { ChatAutomationController } from "./chat-automation-controller.js";
import { mockLogger } from "../test/support/mocks.js";

vi.mock("../utils/telemetry.js", () => ({
  getTracer: () => ({
    startActiveSpan: (_name: string, fn: (span: { setAttribute: () => void }) => unknown) =>
      fn({ setAttribute: () => undefined })
  }),
  setSpanAttributes: () => undefined,
  withSpan: async (_tracer: unknown, _name: string, fn: () => Promise<unknown>) => fn(),
  withRootSpan: async (_tracer: unknown, _name: string, fn: (span: { setAttribute: () => void }) => Promise<unknown>) =>
    fn({ setAttribute: () => undefined })
}));

function businessCtx(update: object, callApi = vi.fn()): Context {
  return {
    update,
    telegram: { callApi }
  } as unknown as Context;
}

function businessMessage(overrides: Record<string, unknown> = {}) {
  return {
    business_connection_id: "bc-1",
    message_id: 10,
    from: { id: 200, is_bot: false, username: "sender" },
    chat: { id: 200, type: "private" },
    text: "hello",
    ...overrides
  };
}

describe("ChatAutomationController", () => {
  it("ignores updates without a business message", async () => {
    const controller = new ChatAutomationController({} as never, {} as never, {} as never, mockLogger() as never);
    await expect(controller.tryHandle({ update: { message: { text: "hi" } } } as Context)).resolves.toBe(false);
  });

  it("ignores non-private chats", async () => {
    const controller = new ChatAutomationController({} as never, {} as never, {} as never, mockLogger() as never);
    const handled = await controller.tryHandle(
      businessCtx({ business_message: businessMessage({ chat: { id: 1, type: "group" } }) })
    );
    expect(handled).toBe(false);
  });

  it("reads business_connection_id from a standard message update", async () => {
    const logger = mockLogger();
    const callApi = vi.fn(async () => ({ user: { id: 55 } }));
    const sessions = {
      findByUserId: vi.fn(async () => null),
      ensureUser: vi.fn(async () => undefined)
    };
    const controller = new ChatAutomationController(
      { execute: vi.fn() } as never,
      { isEnabled: vi.fn(async () => false) } as never,
      sessions as never,
      logger as never
    );
    const handled = await controller.tryHandle(
      businessCtx(
        {
          message: {
            business_connection_id: "bc-2",
            message_id: 1,
            from: { id: 1, is_bot: false },
            chat: { id: 1, type: "private" },
            text: "hi"
          }
        },
        callApi
      )
    );
    expect(handled).toBe(true);
    expect(callApi).toHaveBeenCalledWith("getBusinessConnection", { business_connection_id: "bc-2" });
  });

  it("warns when the business connection has no user id", async () => {
    const logger = mockLogger();
    const callApi = vi.fn(async () => ({}));
    const controller = new ChatAutomationController({} as never, {} as never, {} as never, logger as never);
    await controller.tryHandle(businessCtx({ business_message: businessMessage() }, callApi));
    expect(logger.warn).toHaveBeenCalledWith("chat_automation_connection_missing_user", expect.any(Object));
  });

  it("logs when getBusinessConnection fails", async () => {
    const logger = mockLogger();
    const callApi = vi.fn(async () => {
      throw new Error("api down");
    });
    const controller = new ChatAutomationController({} as never, {} as never, {} as never, logger as never);

    await expect(controller.tryHandle(businessCtx({ business_message: businessMessage() }, callApi))).resolves.toBe(
      true
    );
    expect(logger.error).toHaveBeenCalledWith(
      "chat_automation_get_connection_failed",
      expect.objectContaining({ businessConnectionId: "bc-1" })
    );
  });

  it("logs when moderation lookup fails", async () => {
    const logger = mockLogger();
    const sessions = {
      findByUserId: vi.fn(async () => ({ userId: "100", sessionString: "", active: true })),
      ensureUser: vi.fn()
    };
    const sessionModeration = {
      isEnabled: vi.fn(async () => {
        throw new Error("toggle db down");
      })
    };
    const callApi = vi.fn(async () => ({ user: { id: 100 } }));
    const controller = new ChatAutomationController(
      { execute: vi.fn() } as never,
      sessionModeration as never,
      sessions as never,
      logger as never
    );

    await controller.tryHandle(businessCtx({ business_message: businessMessage() }, callApi));
    expect(logger.error).toHaveBeenCalledWith("chat_automation_session_db_failed", expect.any(Object));
  });

  it("logs process failures without throwing", async () => {
    const logger = mockLogger();
    const processIncoming = {
      execute: vi.fn(async () => {
        throw new Error("moderation failed");
      })
    };
    const sessions = {
      findByUserId: vi.fn(async () => ({ userId: "100", sessionString: "", active: true })),
      ensureUser: vi.fn()
    };
    const sessionModeration = { isEnabled: vi.fn(async () => true) };
    const callApi = vi.fn(async () => ({ user: { id: 100 } }));
    const controller = new ChatAutomationController(
      processIncoming as never,
      sessionModeration as never,
      sessions as never,
      logger as never
    );

    await controller.tryHandle(businessCtx({ business_message: businessMessage() }, callApi));
    expect(logger.error).toHaveBeenCalledWith("chat_automation_process_failed", expect.any(Object));
  });

  it("skips moderation when the owner has not toggled it on", async () => {
    const logger = mockLogger();
    const sessions = {
      findByUserId: vi.fn(async () => null),
      ensureUser: vi.fn(async () => undefined)
    };
    const sessionModeration = { isEnabled: vi.fn(async () => false) };
    const callApi = vi.fn(async () => ({ user: { id: 100, username: "owner" } }));
    const controller = new ChatAutomationController(
      { execute: vi.fn() } as never,
      sessionModeration as never,
      sessions as never,
      logger as never
    );

    await expect(controller.tryHandle(businessCtx({ business_message: businessMessage() }, callApi))).resolves.toBe(
      true
    );
    expect(sessions.ensureUser).toHaveBeenCalledWith("100");
    expect(logger.info).toHaveBeenCalledWith("chat_automation_skipped_moderation_off", expect.any(Object));
  });

  it("logs database failures without throwing", async () => {
    const logger = mockLogger();
    const sessions = {
      findByUserId: vi.fn(async () => {
        throw new Error("db down");
      }),
      ensureUser: vi.fn()
    };
    const callApi = vi.fn(async () => ({ user: { id: 100 } }));
    const controller = new ChatAutomationController(
      { execute: vi.fn() } as never,
      { isEnabled: vi.fn() } as never,
      sessions as never,
      logger as never
    );

    await expect(controller.tryHandle(businessCtx({ business_message: businessMessage() }, callApi))).resolves.toBe(
      true
    );
    expect(logger.error).toHaveBeenCalledWith("chat_automation_session_db_failed", expect.any(Object));
  });

  it("processes inbound automation messages when moderation is enabled", async () => {
    const processIncoming = { execute: vi.fn(async () => undefined) };
    const sessions = {
      findByUserId: vi.fn(async () => ({ userId: "100", sessionString: "", active: true })),
      ensureUser: vi.fn()
    };
    const sessionModeration = { isEnabled: vi.fn(async () => true) };
    const callApi = vi.fn(async () => ({ user: { id: 100, username: "owner" } }));
    const controller = new ChatAutomationController(
      processIncoming as never,
      sessionModeration as never,
      sessions as never,
      mockLogger() as never
    );

    await controller.tryHandle(businessCtx({ business_message: businessMessage() }, callApi));

    expect(processIncoming.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "100",
        senderId: "200",
        source: "bot_api_automation",
        businessConnectionId: "bc-1"
      })
    );
  });

  it("skips owner outbound and bot-sent business messages", async () => {
    const logger = mockLogger();
    const processIncoming = { execute: vi.fn() };
    const sessions = {
      findByUserId: vi.fn(async () => ({ userId: "100", sessionString: "", active: true })),
      ensureUser: vi.fn()
    };
    const sessionModeration = { isEnabled: vi.fn(async () => true) };
    const callApi = vi.fn(async () => ({ user: { id: 100 } }));
    const controller = new ChatAutomationController(
      processIncoming as never,
      sessionModeration as never,
      sessions as never,
      logger as never
    );

    await controller.tryHandle(
      businessCtx({ business_message: businessMessage({ from: { id: 100, is_bot: false } }) }, callApi)
    );
    expect(processIncoming.execute).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith("chat_automation_skipped_owner_outbound", expect.any(Object));

    await controller.tryHandle(
      businessCtx(
        {
          business_message: businessMessage({
            sender_business_bot: { id: 999, username: "bot" }
          })
        },
        callApi
      )
    );
    expect(logger.info).toHaveBeenCalledWith("chat_automation_skipped_bot_business_send", expect.any(Object));
  });
});
