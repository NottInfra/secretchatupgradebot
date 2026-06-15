import { describe, expect, it } from "vitest";
import { SessionModerationToggleMiddleware } from "./session-moderation-toggle-middleware.js";

describe("SessionModerationToggleMiddleware", () => {
  it("returns true when the session is active", async () => {
    const middleware = new SessionModerationToggleMiddleware({
      findByUserId: async () => ({ userId: "1", sessionString: "s", active: true })
    } as never);

    await expect(middleware.isEnabled("1")).resolves.toBe(true);
  });

  it("returns false when moderation is disabled", async () => {
    const middleware = new SessionModerationToggleMiddleware({
      findByUserId: async () => ({ userId: "1", sessionString: "s", active: false })
    } as never);

    await expect(middleware.isEnabled("1")).resolves.toBe(false);
  });

  it("defaults to enabled when no session exists", async () => {
    const middleware = new SessionModerationToggleMiddleware({
      findByUserId: async () => undefined
    } as never);

    await expect(middleware.isEnabled("1")).resolves.toBe(true);
  });
});
