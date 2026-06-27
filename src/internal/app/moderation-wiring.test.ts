import { describe, expect, it } from "vitest";
import { createModerationStack } from "./moderation-wiring.js";
import { mockAnalytics, mockLogger } from "../test/support/mocks.js";

describe("createModerationStack", () => {
  it("wires moderation use cases from persistence ports", () => {
    const stack = createModerationStack(
      { MESSAGE_INSTANCE_COLLAPSE_SECONDS: 60 } as never,
      {
        messages: {} as never,
        actionLogs: {} as never,
        sessions: {} as never,
        handleUserMiddleware: {} as never,
        sessionModerationToggle: {} as never
      },
      {} as never,
      { sendHTML: async () => true } as never,
      mockAnalytics() as never,
      mockLogger() as never
    );
    expect(stack.processIncomingMessage).toBeDefined();
    expect(stack.handleOwnerBlockCallback).toBeDefined();
  });
});
