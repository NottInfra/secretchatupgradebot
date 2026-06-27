import { describe, expect, it, vi } from "vitest";
import { BlockTierHandler } from "./block-tier-handler.js";
import { mockAnalytics, mockLogger, sampleMessage } from "../test/support/mocks.js";

vi.mock("../lib/telemetry.js", () => ({
  getTracer: () => ({}),
  withSpan: async (_t: unknown, _n: string, fn: () => Promise<unknown>) => fn()
}));

describe("BlockTierHandler", () => {
  it("queues block work on the action queue", async () => {
    const enqueue = vi.fn((fn: () => void) => fn());
    const blockOnboarding = {
      executeBlockWithSession: vi.fn(async () => true)
    };
    const handler = new BlockTierHandler(
      { saveDeferred: vi.fn(), hasPriorBlockByOtherSession: vi.fn(async () => false) } as never,
      { enqueue } as never,
      blockOnboarding as never,
      { buildReplyHtml: vi.fn(() => "<p>block</p>") } as never,
      { handle: vi.fn(async () => {}) } as never,
      { assignModerationTier: vi.fn() } as never,
      { sendHTML: vi.fn(async () => true) } as never,
      mockAnalytics() as never,
      mockLogger() as never
    );

    await handler.queue(
      sampleMessage({ businessConnectionId: "bc-1", source: "bot_api_automation" }),
      1,
      3,
      3,
      { action: "block", confidence: 1, reason: "block" },
      { experimentId: "exp", variantId: "v1", html: "<p>block</p>" }
    );

    expect(enqueue).toHaveBeenCalled();
    expect(blockOnboarding.executeBlockWithSession).toHaveBeenCalled();
  });
});
