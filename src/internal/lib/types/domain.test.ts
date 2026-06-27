import { describe, expect, it } from "vitest";
import type { IncomingMessage, SessionRecord } from "./domain.js";

describe("domain types", () => {
  it("models inbound moderation messages and sessions", () => {
    const message: IncomingMessage = {
      sessionId: "owner",
      chatId: "chat",
      senderId: "sender",
      text: "hello",
      date: new Date()
    };
    const session: SessionRecord = { userId: "owner", active: true };
    expect(message.text).toBe("hello");
    expect(session.active).toBe(true);
  });
});
