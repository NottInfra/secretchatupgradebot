import { vi } from "vitest";
import type { IncomingMessage } from "../../types.js";

export function sampleMessage(overrides: Partial<IncomingMessage> = {}): IncomingMessage {
  return {
    senderId: "sender-1",
    chatId: "chat-1",
    sessionId: "owner-1",
    text: "hello",
    date: new Date("2026-01-01T00:00:00.000Z"),
    telegramMessageId: 100,
    ...overrides
  };
}

export function mockLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  };
}

export function mockAnalytics() {
  return { trackEvent: vi.fn() };
}
