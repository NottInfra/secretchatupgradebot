import { describe, expect, it, vi } from "vitest";
import { MessageRepository } from "./message-repository.js";
import { sampleMessage } from "../test/support/mocks.js";

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
});
