import type { ModerationDecision } from "../types.js";

export type ModerationTier = "warning" | "block";

export function moderationTierForCount(count: number): ModerationTier {
  if (count >= 3) return "block";
  return "warning";
}

export function decisionForTier(tier: ModerationTier): ModerationDecision {
  if (tier === "block") {
    return { action: "block", confidence: 1, reason: "third_or_later_message_auto_block" };
  }
  return { action: "allow", confidence: 1, reason: "message_warning_sent" };
}
