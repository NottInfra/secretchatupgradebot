import { describe, expect, it, vi } from "vitest";
import { ActionLogRepository } from "./action-log-repository.js";

describe("ActionLogRepository", () => {
  it("checks prior blocks and saves deferred actions", async () => {
    const read = vi
      .fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const writeDeferred = vi.fn();
    const repo = new ActionLogRepository({ read, writeDeferred } as never);

    await expect(repo.hasPriorBlockInSession("sender", "owner")).resolves.toBe(true);
    await expect(repo.hasPriorBlockByOtherSession("sender", "owner")).resolves.toBe(false);

    repo.saveDeferred({
      senderId: "sender",
      chatId: "chat",
      sessionId: "owner",
      decision: { action: "block", confidence: 1, reason: "test" }
    });

    expect(writeDeferred).toHaveBeenCalledOnce();
  });
});
