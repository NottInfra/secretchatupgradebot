import { describe, expect, it } from "vitest";
import { createModerationContainer } from "./container.js";
import { mockModerationDeps } from "../test/support/mocks.js";

describe("createModerationContainer", () => {
  it("wires the process incoming use case", () => {
    const container = createModerationContainer(mockModerationDeps());
    expect(container.processIncomingMessage).toBeDefined();
    expect(container.priorBlockOwnerPrompt).toBeDefined();
  });
});
