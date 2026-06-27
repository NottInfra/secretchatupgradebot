import { describe, expect, it } from "vitest";
import { createPersistenceStack } from "./persistence-wiring.js";
import { mockAnalytics } from "../test/support/mocks.js";
import type { Store } from "../lib/db/root.js";

describe("createPersistenceStack", () => {
  it("wires repositories and middleware from the store", () => {
    const store = {} as Store;
    const stack = createPersistenceStack(store, mockAnalytics() as never);

    expect(stack.messages).toBeDefined();
    expect(stack.actionLogs).toBeDefined();
    expect(stack.sessions).toBeDefined();
    expect(stack.handleUserMiddleware).toBeDefined();
    expect(stack.sessionModerationToggle).toBeDefined();
  });
});
