import { describe, expect, it, vi } from "vitest";
import { PriorBlockSkipHandler } from "./prior-block-skip-handler.js";
import { mockAnalytics, mockLogger, sampleMessage } from "../test/support/mocks.js";

describe("PriorBlockSkipHandler", () => {
  it("returns false when sender has no prior block in session", async () => {
    const actions = { hasPriorBlockInSession: vi.fn(async () => false), saveDeferred: vi.fn() };
    const handler = new PriorBlockSkipHandler(
      actions as never,
      mockAnalytics() as never,
      mockLogger() as never
    );

    const skipped = await handler.trySkip(sampleMessage(), 42);
    expect(skipped).toBe(false);
    expect(actions.saveDeferred).not.toHaveBeenCalled();
  });

  it("records skip decision when sender was already blocked in session", async () => {
    const analytics = mockAnalytics();
    const logger = mockLogger();
    const actions = { hasPriorBlockInSession: vi.fn(async () => true), saveDeferred: vi.fn() };
    const handler = new PriorBlockSkipHandler(actions as never, analytics as never, logger as never);

    const skipped = await handler.trySkip(sampleMessage(), 7);
    expect(skipped).toBe(true);
    expect(actions.saveDeferred).toHaveBeenCalledWith({
      incomingMessageId: 7,
      decision: expect.objectContaining({ action: "ignore", reason: "prior_block_in_session_skip" })
    });
    expect(analytics.trackEvent).toHaveBeenCalledWith(
      "moderation_decision",
      expect.objectContaining({ tier: "skipped_prior_block" })
    );
    expect(logger.info).toHaveBeenCalledWith("moderation_skipped_prior_block", expect.any(Object));
  });
});
