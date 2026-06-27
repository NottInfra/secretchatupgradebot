import { describe, expect, it, vi } from "vitest";
import type { Telegraf } from "telegraf";
import { BusinessAutomationNotifier } from "./business-automation-notifier.js";
import { mockLogger } from "../test/support/mocks.js";

vi.mock("../lib/telemetry.js", () => ({
  getTracer: () => ({}),
  setSpanAttributes: () => undefined,
  withSpan: async (_t: unknown, _n: string, fn: () => Promise<unknown>) => fn()
}));

describe("BusinessAutomationNotifier", () => {
  it("sends html business replies", async () => {
    const callApi = vi.fn(async () => ({}));
    const bot = { telegram: { callApi } } as unknown as Telegraf;
    const notifier = new BusinessAutomationNotifier(() => bot, mockLogger() as never);
    await expect(
      notifier.sendHTMLReply({ businessConnectionId: "bc", chatId: "10", html: "<b>hi</b>" })
    ).resolves.toBe(true);
    expect(callApi).toHaveBeenCalledWith("sendMessage", expect.objectContaining({ parse_mode: "HTML" }));
  });
});
