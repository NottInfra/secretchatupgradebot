import { describe, expect, it, vi } from "vitest";
import { MessageRepository } from "./message-repository.js";

describe("MessageRepository", () => {
  it("persists and counts messages by sender", async () => {
    const write = vi.fn(async () => undefined);
    const read = vi.fn(async () => 2);
    const repo = new MessageRepository({ write, read } as never);

    await repo.save({
      sessionId: "owner",
      chatId: "chat",
      senderId: "sender",
      text: "hi",
      date: new Date()
    });

    expect(write).toHaveBeenCalledWith(
      "messages.insert",
      "sender",
      "chat",
      "owner",
      expect.any(String)
    );
    await expect(repo.countBySender("sender", "owner")).resolves.toBe(2);
    expect(read).toHaveBeenCalledWith("messages.count_by_sender", 0, "sender", "owner", 0);
  });
});
