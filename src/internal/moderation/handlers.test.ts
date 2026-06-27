import { describe, expect, it } from "vitest";
import { createModerationHandlers } from "./handlers.js";
import { mockModerationDeps } from "../test/support/mocks.js";

describe("createModerationHandlers", () => {
  it("constructs tier handlers and evaluators", () => {
    const handlers = createModerationHandlers(mockModerationDeps());
    expect(handlers.priorBlockOwnerPrompt).toBeDefined();
    expect(handlers.warningTier).toBeDefined();
    expect(handlers.blockTier).toBeDefined();
    expect(handlers.skipEvaluator).toBeDefined();
    expect(handlers.priorBlockSkip).toBeDefined();
  });
});
