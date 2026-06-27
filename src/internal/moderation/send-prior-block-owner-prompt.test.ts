import { describe, expect, it, vi } from "vitest";
import { SendPriorBlockOwnerPromptUseCase } from "./send-prior-block-owner-prompt.js";
import { PendingBlockOfferStore } from "./pending-block-offer-store.js";
import { mockAnalytics, mockLogger, sampleMessage } from "../test/support/mocks.js";

describe("SendPriorBlockOwnerPromptUseCase", () => {
  it("sends an inline block prompt to the owner", async () => {
    const notifications = {
      sendHTMLWithInlineButton: vi.fn(async () => true)
    };
    const useCase = new SendPriorBlockOwnerPromptUseCase(
      new PendingBlockOfferStore(),
      notifications as never,
      mockAnalytics() as never,
      mockLogger() as never
    );

    await useCase.execute(sampleMessage(), 1, {
      experimentId: "exp",
      variantId: "a",
      html: "warning"
    });

    expect(notifications.sendHTMLWithInlineButton).toHaveBeenCalledOnce();
  });
});
