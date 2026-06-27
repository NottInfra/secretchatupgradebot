import { describe, expect, it, vi } from "vitest";
import { ExecuteModerationActionUseCase } from "./execute-moderation-action.js";
import { mockLogger, sampleMessage } from "../test/support/mocks.js";

describe("ExecuteModerationActionUseCase", () => {
  it("ignores non-block decisions", async () => {
    const notifications = { sendBusinessHTMLReply: vi.fn() };
    const useCase = new ExecuteModerationActionUseCase(notifications as never, mockLogger() as never);

    await useCase.execute({ invoke: vi.fn() } as never, {
      senderId: "1",
      decision: { action: "allow", confidence: 1, reason: "noop" }
    });

    expect(notifications.sendBusinessHTMLReply).not.toHaveBeenCalled();
  });

  it("sends a business automation block message and blocks via tdlib", async () => {
    const notifications = { sendBusinessHTMLReply: vi.fn(async () => true) };
    const invoke = vi.fn(async (query: { _: string }) => {
      if (query._ === "getMe") return { id: 999 };
      return undefined;
    });
    const client = { invoke };
    const useCase = new ExecuteModerationActionUseCase(notifications as never, mockLogger() as never);

    const blocked = await useCase.execute(client as never, {
      senderId: "1",
      decision: { action: "block", confidence: 1, reason: "test" },
      blockMessageHtml: "<b>Blocked</b>",
      moderationIncoming: sampleMessage({
        source: "bot_api_automation",
        businessConnectionId: "bc-1"
      })
    });

    expect(blocked).toBe(true);
    expect(notifications.sendBusinessHTMLReply).toHaveBeenCalledOnce();
    expect(invoke).toHaveBeenCalledWith(
      expect.objectContaining({ _: "setMessageSenderBlockList", block_list: null })
    );
    expect(invoke).toHaveBeenCalledWith(
      expect.objectContaining({
        _: "setMessageSenderBlockList",
        block_list: { _: "blockListMain" }
      })
    );
  });

  it("skips contact block for self peer", async () => {
    const notifications = { sendBusinessHTMLReply: vi.fn(async () => true) };
    const client = {
      invoke: vi.fn(async (query: { _: string }) => {
        if (query._ === "getMe") return { id: 1 };
        return undefined;
      })
    };
    const useCase = new ExecuteModerationActionUseCase(notifications as never, mockLogger() as never);

    const blocked = await useCase.execute(client as never, {
      senderId: "1",
      decision: { action: "block", confidence: 1, reason: "test" },
      blockMessageHtml: "<b>Blocked</b>",
      moderationIncoming: sampleMessage({
        source: "bot_api_automation",
        businessConnectionId: "bc-1"
      })
    });

    expect(blocked).toBe(false);
    expect(notifications.sendBusinessHTMLReply).not.toHaveBeenCalled();
    expect(client.invoke).not.toHaveBeenCalledWith(
      expect.objectContaining({ block_list: { _: "blockListMain" } })
    );
  });

  it("does not send block message when tdlib block fails", async () => {
    const notifications = { sendBusinessHTMLReply: vi.fn(async () => true) };
    const client = {
      invoke: vi.fn(async (query: { _: string; block_list?: unknown }) => {
        if (query._ === "getMe") return { id: 999 };
        if (query.block_list) throw new Error("TDLib block failed");
        return undefined;
      })
    };
    const useCase = new ExecuteModerationActionUseCase(notifications as never, mockLogger() as never);

    const blocked = await useCase.execute(client as never, {
      senderId: "1",
      decision: { action: "block", confidence: 1, reason: "test" },
      blockMessageHtml: "<b>Blocked</b>",
      moderationIncoming: sampleMessage({
        source: "bot_api_automation",
        businessConnectionId: "bc-1"
      })
    });

    expect(blocked).toBe(false);
    expect(notifications.sendBusinessHTMLReply).not.toHaveBeenCalled();
  });
});
