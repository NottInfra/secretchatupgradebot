import { describe, expect, it, vi } from "vitest";
import { Api } from "telegram";
import { ExecuteModerationActionUseCase } from "./execute-moderation-action.js";
import { mockLogger, sampleMessage } from "../test/support/mocks.js";

describe("ExecuteModerationActionUseCase", () => {
  it("ignores non-block decisions", async () => {
    const notifications = { sendBusinessHTMLReply: vi.fn() };
    const useCase = new ExecuteModerationActionUseCase(notifications as never, mockLogger() as never);

    await useCase.execute({} as never, {
      senderId: "1",
      decision: { action: "allow", confidence: 1, reason: "noop" }
    });

    expect(notifications.sendBusinessHTMLReply).not.toHaveBeenCalled();
  });

  it("sends a business automation block message", async () => {
    const notifications = { sendBusinessHTMLReply: vi.fn(async () => true) };
    const client = {
      getInputEntity: vi.fn(async () => ({})),
      invoke: vi.fn(async () => undefined)
    };
    const useCase = new ExecuteModerationActionUseCase(notifications as never, mockLogger() as never);

    await useCase.execute(client as never, {
      senderId: "sender-1",
      decision: { action: "block", confidence: 1, reason: "test" },
      blockMessageHtml: "<b>Blocked</b>",
      moderationIncoming: sampleMessage({
        source: "bot_api_automation",
        businessConnectionId: "bc-1"
      })
    });

    expect(notifications.sendBusinessHTMLReply).toHaveBeenCalledOnce();
    expect(client.invoke).toHaveBeenCalledOnce();
  });

  it("skips contact block for self peer", async () => {
    const notifications = { sendBusinessHTMLReply: vi.fn(async () => true) };
    const client = {
      getInputEntity: vi.fn(async () => new Api.InputPeerSelf()),
      sendMessage: vi.fn(async () => ({ id: 1 })),
      invoke: vi.fn(async () => undefined)
    };
    const useCase = new ExecuteModerationActionUseCase(notifications as never, mockLogger() as never);

    await useCase.execute(client as never, {
      senderId: "sender-1",
      decision: { action: "block", confidence: 1, reason: "test" },
      blockMessageHtml: "<b>Blocked</b>",
      moderationIncoming: sampleMessage()
    });

    expect(client.sendMessage).toHaveBeenCalledOnce();
    expect(client.invoke).not.toHaveBeenCalled();
  });
});
