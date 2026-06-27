import { describe, expect, it } from "vitest";
import { SessionModerationToggleMiddleware } from "./session-moderation-toggle-middleware.js";

describe("SessionModerationToggleMiddleware", () => {
  it("returns true when the session is active", async () => {
    const middleware = new SessionModerationToggleMiddleware({
      findByUserId: async () => ({ userId: "1", active: true })
    } as never);

    await expect(middleware.isEnabled("1")).resolves.toBe(true);
  });

  it("returns false when moderation is disabled", async () => {
    const middleware = new SessionModerationToggleMiddleware({
      findByUserId: async () => ({ userId: "1", active: false })
    } as never);

    await expect(middleware.isEnabled("1")).resolves.toBe(false);
  });

  it("returns false when no session exists", async () => {
    const middleware = new SessionModerationToggleMiddleware({
      findByUserId: async () => null
    } as never);

    await expect(middleware.isEnabled("1")).resolves.toBe(false);
  });
});
