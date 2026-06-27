import { describe, expect, it, vi } from "vitest";
import { ModerationSkipEvaluator } from "./moderation-skip-evaluator.js";
import { mockAnalytics, mockLogger, sampleMessage } from "../test/support/mocks.js";

describe("ModerationSkipEvaluator", () => {
  it("skips bot senders", async () => {
    const dedupe = { tryClaim: vi.fn(async () => true) };
    const evaluator = new ModerationSkipEvaluator(dedupe as never, mockAnalytics() as never, mockLogger() as never);
    const result = await evaluator.evaluate(sampleMessage({ senderIsBot: true }));
    expect(result).toEqual({ skip: true });
    expect(dedupe.tryClaim).not.toHaveBeenCalled();
  });

  it("skips owner outbound automation messages", async () => {
    const dedupe = { tryClaim: vi.fn(async () => true) };
    const evaluator = new ModerationSkipEvaluator(dedupe as never, mockAnalytics() as never, mockLogger() as never);
    const result = await evaluator.evaluate(
      sampleMessage({
        source: "bot_api_automation",
        sessionId: "owner-1",
        senderId: "owner-1"
      })
    );
    expect(result).toEqual({ skip: true });
  });

  it("skips duplicate telegram message ids", async () => {
    const dedupe = { tryClaim: vi.fn(async () => false) };
    const evaluator = new ModerationSkipEvaluator(dedupe as never, mockAnalytics() as never, mockLogger() as never);
    const result = await evaluator.evaluate(sampleMessage({ telegramMessageId: 100 }));
    expect(result).toEqual({ skip: true });
    expect(dedupe.tryClaim).toHaveBeenCalledWith("chat-1", 100);
  });

  it("allows unique inbound messages", async () => {
    const dedupe = { tryClaim: vi.fn(async () => true) };
    const evaluator = new ModerationSkipEvaluator(dedupe as never, mockAnalytics() as never, mockLogger() as never);
    await expect(evaluator.evaluate(sampleMessage({ telegramMessageId: 101 }))).resolves.toEqual({ skip: false });
  });
});
