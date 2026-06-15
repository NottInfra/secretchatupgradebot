import { describe, expect, it } from "vitest";
import { InboundMessageDedupe } from "./inbound-message-dedupe.js";

describe("InboundMessageDedupe", () => {
  it("claims the first message id only once", () => {
    const dedupe = new InboundMessageDedupe();
    expect(dedupe.tryClaim("chat-1", 42)).toBe(true);
    expect(dedupe.tryClaim("chat-1", 42)).toBe(false);
  });

  it("tracks ids independently per chat", () => {
    const dedupe = new InboundMessageDedupe();
    expect(dedupe.tryClaim("chat-1", 1)).toBe(true);
    expect(dedupe.tryClaim("chat-2", 1)).toBe(true);
  });

  it("allows reclaim after ttl expires", () => {
    const dedupe = new InboundMessageDedupe({ ttlMs: 1 });
    expect(dedupe.tryClaim("chat-1", 7)).toBe(true);
    expect(dedupe.tryClaim("chat-1", 7)).toBe(false);
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(dedupe.tryClaim("chat-1", 7)).toBe(true);
        resolve();
      }, 5);
    });
  });
});
