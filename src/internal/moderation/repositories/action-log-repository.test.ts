import { describe, expect, it, vi } from "vitest";
import { ActionLogRepository } from "./action-log-repository.js";

describe("ActionLogRepository", () => {
  it("checks prior blocks and saves deferred actions", async () => {
    const read = vi
      .fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const write = vi.fn(async () => undefined);
    const writeDeferred = vi.fn();
    const repo = new ActionLogRepository({ read, write, writeDeferred } as never);

    await expect(repo.hasPriorBlockInSession("sender", "owner")).resolves.toBe(true);
    await expect(repo.hasPriorBlockByOtherSession("sender", "owner")).resolves.toBe(false);

    await repo.save({
      incomingMessageId: 12,
      decision: { action: "block", confidence: 1, reason: "test" }
    });

    repo.saveDeferred({
      incomingMessageId: 99,
      decision: { action: "block", confidence: 1, reason: "test" }
    });

    expect(write).toHaveBeenCalledOnce();
    expect(writeDeferred).toHaveBeenCalledOnce();
  });
});
