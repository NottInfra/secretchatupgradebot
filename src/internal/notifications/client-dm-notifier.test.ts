import { describe, expect, it, vi } from "vitest";
import { ClientDmNotifier } from "./client-dm-notifier.js";
import { mockLogger } from "../test/support/mocks.js";

vi.mock("../lib/telemetry.js", () => ({
  getTracer: () => ({}),
  setSpanAttributes: () => undefined,
  withSpan: async (_t: unknown, _n: string, fn: () => Promise<unknown>) => fn()
}));

describe("ClientDmNotifier", () => {
  it("sends html messages to resolved user ids", async () => {
    const sendMessage = vi.fn(async () => ({ message_id: 1 }));
    const bot = { telegram: { sendMessage } };
    const notifier = new ClientDmNotifier(() => bot as never, mockLogger() as never);

    await expect(notifier.sendHTML("42", "<b>hi</b>")).resolves.toBe(true);
    expect(sendMessage).toHaveBeenCalledWith(42, "<b>hi</b>", expect.objectContaining({ parse_mode: "HTML" }));
  });
});
