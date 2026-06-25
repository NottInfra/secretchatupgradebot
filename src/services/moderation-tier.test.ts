import { describe, expect, it } from "vitest";
import { decisionForTier, moderationTierForCount } from "./moderation-tier.js";

describe("moderationTierForCount", () => {
  it("maps message counts to tiers", () => {
    expect(moderationTierForCount(1)).toBe("warning");
    expect(moderationTierForCount(2)).toBe("warning");
    expect(moderationTierForCount(3)).toBe("block");
    expect(moderationTierForCount(10)).toBe("block");
  });
});

describe("decisionForTier", () => {
  it("returns the expected moderation decision", () => {
    expect(decisionForTier("warning")).toEqual({
      action: "allow",
      confidence: 1,
      reason: "message_warning_sent"
    });
    expect(decisionForTier("block")).toEqual({
      action: "block",
      confidence: 1,
      reason: "third_or_later_instance_auto_block"
    });
  });
});
