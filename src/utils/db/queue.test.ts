import { describe, expect, it, vi } from "vitest";
import { DeferredWriteQueue } from "./queue.js";

describe("DeferredWriteQueue", () => {
  it("runs enqueued tasks in order", async () => {
    const queue = new DeferredWriteQueue();
    const order: number[] = [];

    await Promise.all([
      queue.enqueue("a", async () => {
        order.push(1);
      }),
      queue.enqueue("b", async () => {
        order.push(2);
      })
    ]);

    expect(order).toEqual([1, 2]);
  });

  it("retries failed tasks before moving them to the dlq", async () => {
    const queue = new DeferredWriteQueue(1, 1, 1, 10, 1);
    let attempts = 0;

    await expect(
      queue.enqueue("flaky", async () => {
        attempts += 1;
        if (attempts < 2) throw new Error("temporary");
      })
    ).resolves.toBeUndefined();

    expect(attempts).toBe(2);
  });

  it("pushes permanently failing tasks to the dlq", async () => {
    const queue = new DeferredWriteQueue(0, 1, 1, 10, 1);

    await expect(
      queue.enqueue("bad", async () => {
        throw new Error("permanent");
      })
    ).rejects.toThrow(/permanent/);

    expect(queue.getDlq()).toHaveLength(1);
  });

  it("supports fire-and-forget enqueue", async () => {
    const queue = new DeferredWriteQueue();
    const task = vi.fn(async () => undefined);
    queue.enqueueFireAndForget("ff", task);
    await queue.enqueue("sync", async () => undefined);
    expect(task).toHaveBeenCalledOnce();
  });
});
