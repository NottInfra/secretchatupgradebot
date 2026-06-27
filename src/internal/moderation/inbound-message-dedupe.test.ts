import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

  describe("ttl expiry", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("allows reclaim after ttl expires", () => {
      const dedupe = new InboundMessageDedupe({ ttlMs: 1_000 });

      expect(dedupe.tryClaim("chat-1", 7)).toBe(true);
      expect(dedupe.tryClaim("chat-1", 7)).toBe(false);

      vi.advanceTimersByTime(1_000);
      expect(dedupe.tryClaim("chat-1", 7)).toBe(true);
    });
  });
});
