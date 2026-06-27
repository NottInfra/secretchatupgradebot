import { describe, expect, it, vi } from "vitest";
import type { Telegraf } from "telegraf";
import { sendBusinessMediaMessage } from "./business-media-sender.js";
import { mockLogger } from "../test/support/mocks.js";

describe("sendBusinessMediaMessage", () => {
  it("calls sendPhoto for image media", async () => {
    const callApi = vi.fn(async () => ({}));
    const bot = { telegram: { callApi } } as unknown as Telegraf;
    await sendBusinessMediaMessage(
      bot,
      { businessConnectionId: "bc", chatId: "10", mediaPath: "/tmp/x.jpg", html: "<b>c</b>" },
      10,
      false,
      mockLogger() as never
    );
    expect(callApi).toHaveBeenCalledWith("sendPhoto", expect.objectContaining({ chat_id: 10 }));
  });
});
