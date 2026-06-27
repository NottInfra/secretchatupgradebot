import { describe, expect, it, vi } from "vitest";
import { ActionQueueService } from "./action-queue-service.js";
import { flushQueue, mockLogger } from "../test/support/mocks.js";

describe("ActionQueueService", () => {
  it("runs queued tasks sequentially", async () => {
    const order: number[] = [];
    const queue = new ActionQueueService(mockLogger() as never, 0);
    queue.enqueue(async () => {
      order.push(1);
    });
    queue.enqueue(async () => {
      order.push(2);
    });

    await flushQueue();
    expect(order).toEqual([1, 2]);
  });

  it("logs task failures without stopping the queue", async () => {
    const logger = mockLogger();
    const queue = new ActionQueueService(logger as never, 0);
    const ok = vi.fn();

    queue.enqueue(async () => {
      throw new Error("task failed");
    });
    queue.enqueue(async () => {
      ok();
    });

    await flushQueue();
    expect(logger.error).toHaveBeenCalled();
    expect(ok).toHaveBeenCalledOnce();
  });
});
