import { describe, expect, it, vi } from "vitest";
import { HandleUserMiddleware } from "./handle-user-middleware.js";

describe("HandleUserMiddleware", () => {
  it("rejects invalid telegram users", async () => {
    const write = vi.fn();
    const middleware = new HandleUserMiddleware({ write } as never);

    await expect(
      middleware.ensureUser(
        { telegramId: 0, username: "", firstName: "", lastName: "" },
        123
      )
    ).rejects.toThrow("invalid_telegram_user");
    expect(write).not.toHaveBeenCalled();
  });

  it("upserts telegram users", async () => {
    const write = vi.fn(async () => undefined);
    const analytics = { trackEvent: vi.fn() };
    const middleware = new HandleUserMiddleware({ write } as never, analytics as never);

    await middleware.ensureUser(
      { telegramId: 42, username: "alice", firstName: "Alice", lastName: "A" },
      999
    );

    expect(write).toHaveBeenCalledWith(
      "users.upsert",
      42,
      "alice",
      "Alice",
      "A",
      expect.any(String)
    );
    expect(analytics.trackEvent).not.toHaveBeenCalled();
  });

  it("tracks rejected users in analytics when provided", async () => {
    const analytics = { trackEvent: vi.fn() };
    const middleware = new HandleUserMiddleware({ write: vi.fn() } as never, analytics as never);

    await expect(
      middleware.ensureUser(
        { telegramId: 0, username: "", firstName: "", lastName: "" },
        123
      )
    ).rejects.toThrow("invalid_telegram_user");

    expect(analytics.trackEvent).toHaveBeenCalledWith("user_ensure_rejected", {
      status: "invalid",
      reason: "zero_telegram_id",
      chatId: 123
    });
  });
});
