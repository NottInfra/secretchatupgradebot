import { describe, expect, it } from "vitest";
import { shouldSkipAutomationMessage } from "./automation-guards.js";

describe("shouldSkipAutomationMessage", () => {
  const base = {
    message_id: 1,
    chat: { id: 10 },
    from: { id: 200, username: "sender" }
  };

  it("skips business bot sends", () => {
    expect(
      shouldSkipAutomationMessage(
        { ...base, sender_business_bot: { id: 1, username: "bot" } },
        base.from,
        "owner"
      )
    ).toEqual({ skip: true, reason: "bot_business_send" });
  });

  it("skips owner outbound messages", () => {
    expect(shouldSkipAutomationMessage(base, { id: 42 }, "42")).toEqual({
      skip: true,
      reason: "owner_outbound"
    });
  });

  it("allows inbound client messages", () => {
    expect(shouldSkipAutomationMessage(base, base.from, "owner")).toEqual({ skip: false });
  });
});
