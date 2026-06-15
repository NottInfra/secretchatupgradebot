import type { ModerationDecision } from "../types.js";

export type ModerationTier = "first_warning" | "second_warning" | "block";

export function moderationTierForCount(count: number): ModerationTier {
  if (count === 1) return "first_warning";
  if (count === 2) return "second_warning";
  return "block";
}

export function decisionForTier(tier: ModerationTier): ModerationDecision {
  if (tier === "block") {
    return { action: "block", confidence: 1, reason: "third_or_later_message_auto_block" };
  }
  if (tier === "second_warning") {
    return { action: "allow", confidence: 1, reason: "second_message_warning_sent" };
  }
  return { action: "allow", confidence: 1, reason: "first_message_reply_sent" };
}
