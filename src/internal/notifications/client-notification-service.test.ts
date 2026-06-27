import { describe, expect, it, vi } from "vitest";
import { ClientNotificationService } from "./client-notification-service.js";
import { mockLogger } from "../test/support/mocks.js";

vi.mock("../lib/telemetry.js", () => ({
  getTracer: () => ({}),
  setSpanAttributes: () => undefined,
  withSpan: async (_t: unknown, _n: string, fn: () => Promise<unknown>) => fn()
}));

describe("ClientNotificationService", () => {
  it("delegates html sends to the dm notifier after bot attach", async () => {
    const service = new ClientNotificationService(mockLogger() as never);
    const sendMessage = vi.fn(async () => ({ message_id: 1 }));
    service.attachBot({ telegram: { sendMessage } } as never);

    await service.sendHTML("42", "<b>hi</b>");

    expect(sendMessage).toHaveBeenCalledWith(42, "<b>hi</b>", expect.objectContaining({ parse_mode: "HTML" }));
  });
});
