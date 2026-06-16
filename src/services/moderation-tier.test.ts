import { describe, expect, it } from "vitest";
import { decisionForTier, moderationTierForCount } from "./moderation-tier.js";

describe("moderationTierForCount", () => {
  it("maps message counts to tiers", () => {
    expect(moderationTierForCount(1)).toBe("first_warning");
    expect(moderationTierForCount(2)).toBe("second_warning");
    expect(moderationTierForCount(3)).toBe("block");
    expect(moderationTierForCount(10)).toBe("block");
  });
});

describe("decisionForTier", () => {
  it("returns the expected moderation decision", () => {
    expect(decisionForTier("first_warning")).toEqual({
      action: "allow",
      confidence: 1,
      reason: "first_message_reply_sent"
    });
    expect(decisionForTier("second_warning")).toEqual({
      action: "allow",
      confidence: 1,
      reason: "second_message_warning_sent"
    });
    expect(decisionForTier("block")).toEqual({
      action: "block",
      confidence: 1,
      reason: "third_or_later_message_auto_block"
    });
  });
});
