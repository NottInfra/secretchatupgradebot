import { describe, expect, it, vi } from "vitest";
import { ModerationReplyService } from "./moderation-reply-service.js";
import { mockLogger } from "../test/support/mocks.js";
import { sampleMessage } from "../test/support/mocks.js";

describe("ModerationReplyService", () => {
  it("substitutes template placeholders in reply html", () => {
    const notifications = { sendBusinessHTMLReply: vi.fn(async () => true) };
    const service = new ModerationReplyService(notifications as never, mockLogger() as never);
    const html = service.buildReplyHtml(
      sampleMessage({ sessionOwnerUsername: "owner", senderUsername: "sender" }),
      { experimentId: "exp", variantId: "v1", html: "Hi {{SESSION_USERNAME}} from {{SENDER_USERNAME}} (#{{X_WARNING_NUMBER}})" },
      3
    );
    expect(html).toContain("@owner");
    expect(html).toContain("sender");
    expect(html).toContain("#3");
  });
});
