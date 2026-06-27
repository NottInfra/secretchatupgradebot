import { describe, expect, it, vi } from "vitest";
import { MessageRepository } from "./message-repository.js";
import { sampleMessage } from "../../test/support/mocks.js";

describe("MessageRepository", () => {
  it("persists and counts messages by sender", async () => {
    const write = vi.fn(async () => 42);
    const read = vi.fn(async () => 2);
    const repo = new MessageRepository({ write, read } as never);
    const message = sampleMessage();

    await expect(repo.save(message)).resolves.toBe(42);
    await expect(repo.countBySender("sender", "owner")).resolves.toBe(2);

    expect(write).toHaveBeenCalledWith(
      "incoming_messages.insert",
      message.senderId,
      message.sessionId,
      message.date.toISOString()
    );
    expect(read).toHaveBeenCalledWith("incoming_messages.count_by_sender", 0, "sender", "owner", 0);
  });

  it("counts collapsed instances by sender and receiver", async () => {
    const write = vi.fn(async () => 42);
    const read = vi.fn(async () => 2);
    const repo = new MessageRepository({ write, read } as never);

    await expect(repo.countInstancesBySender("sender", "owner", 30)).resolves.toBe(2);

    expect(read).toHaveBeenCalledWith("incoming_messages.count_by_sender", 0, "sender", "owner", 30);
  });

  it("counts messages inside a collapse window", async () => {
    const write = vi.fn(async () => 1);
    const read = vi.fn(async () => 4);
    const repo = new MessageRepository({ write, read } as never);

    await expect(
      repo.countInMessagingInstance("sender", new Date("2026-06-25T00:00:00.000Z"), 30)
    ).resolves.toBe(4);

    expect(read).toHaveBeenCalledWith(
      "incoming_messages.count_in_instance",
      0,
      "sender",
      "2026-06-25T00:00:00.000Z",
      30
    );
  });
});
