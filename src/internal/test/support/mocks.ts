import { vi } from "vitest";
import type { IncomingMessage } from "../../lib/types/index.js";
import type { ModerationDeps } from "../../moderation/deps.js";

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

export async function flushQueue(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

export function mockModerationDeps(overrides: Partial<ModerationDeps> = {}): ModerationDeps {
  return {
    messages: {} as never,
    inboundDedupe: { seen: async () => false } as never,
    actionLogs: {} as never,
    experiments: {
      assignModerationTier: () => ({ experimentId: "e", variantId: "v", html: "<p>x</p>" })
    } as never,
    actionQueue: { enqueue: (fn: () => void) => fn() } as never,
    moderationReply: {
      buildReplyHtml: () => "<p>reply</p>",
      sendFirstMessageReply: async () => {}
    } as never,
    blockOnboarding: {} as never,
    pendingBlockOffers: { create: () => "token", consume: () => undefined } as never,
    notifications: { sendHTML: async () => true } as never,
    analytics: mockAnalytics() as never,
    logger: mockLogger() as never,
    messageInstanceCollapseSeconds: 60,
    ...overrides
  };
}
