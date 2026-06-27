import { describe, expect, it, vi } from "vitest";
import { WarningTierHandler } from "./warning-tier-handler.js";
import { mockAnalytics, mockLogger, sampleMessage } from "../test/support/mocks.js";

describe("WarningTierHandler", () => {
  it("sends warning reply and records deferred action", async () => {
    const reply = {
      buildReplyHtml: vi.fn(() => "<p>warn</p>"),
      sendFirstMessageReply: vi.fn(async () => {})
    };
    const actions = { saveDeferred: vi.fn() };
    const priorBlockOwnerPrompt = { execute: vi.fn(async () => {}) };
    const handler = new WarningTierHandler(
      actions as never,
      reply as never,
      priorBlockOwnerPrompt as never,
      mockAnalytics() as never,
      mockLogger() as never,
      60
    );

    await handler.handle(
      sampleMessage({ businessConnectionId: "bc-1", source: "bot_api_automation" }),
      9,
      2,
      2,
      { action: "ignore", confidence: 1, reason: "warning" },
      { experimentId: "exp", variantId: "v1", html: "<p>warn</p>" },
      false
    );

    expect(reply.sendFirstMessageReply).toHaveBeenCalled();
    expect(actions.saveDeferred).toHaveBeenCalled();
    expect(priorBlockOwnerPrompt.execute).not.toHaveBeenCalled();
  });

  it("prompts owner when sender was blocked on another account", async () => {
    const reply = {
      buildReplyHtml: vi.fn(() => "<p>warn</p>"),
      sendFirstMessageReply: vi.fn(async () => {})
    };
    const priorBlockOwnerPrompt = { execute: vi.fn(async () => {}) };
    const handler = new WarningTierHandler(
      { saveDeferred: vi.fn() } as never,
      reply as never,
      priorBlockOwnerPrompt as never,
      mockAnalytics() as never,
      mockLogger() as never,
      60
    );

    await handler.handle(
      sampleMessage(),
      3,
      1,
      1,
      { action: "ignore", confidence: 1, reason: "warning" },
      { experimentId: "exp", variantId: "v1", html: "<p>warn</p>" },
      true
    );

    expect(priorBlockOwnerPrompt.execute).toHaveBeenCalled();
  });
});
