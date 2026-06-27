import type { AutomationMessageShape } from "./automation-message.js";

export function shouldSkipAutomationMessage(
  msg: AutomationMessageShape,
  from: NonNullable<AutomationMessageShape["from"]>,
  ownerUserId: string
): { skip: true; reason: "bot_business_send" | "owner_outbound" } | { skip: false } {
  if (msg.sender_business_bot != null) {
    return { skip: true, reason: "bot_business_send" };
  }

  if (String(from.id) === ownerUserId) {
    return { skip: true, reason: "owner_outbound" };
  }

  return { skip: false };
}
