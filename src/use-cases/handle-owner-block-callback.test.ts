import { describe, expect, it, vi } from "vitest";
import { HandleOwnerBlockCallbackUseCase } from "./handle-owner-block-callback.js";
import { PendingBlockOfferStore } from "../services/pending-block-offer-store.js";
import { mockAnalytics, mockLogger, sampleMessage } from "../test/support/mocks.js";

describe("HandleOwnerBlockCallbackUseCase", () => {
  it("rejects expired offers", async () => {
    const useCase = new HandleOwnerBlockCallbackUseCase(
      new PendingBlockOfferStore(),
      {} as never,
      { execute: vi.fn() } as never,
      {} as never,
      { assignModerationTier: vi.fn() } as never,
      {} as never,
      mockAnalytics() as never,
      mockLogger() as never
    );

    const message = await useCase.execute(1, "missing-token");
    expect(message).toMatch(/expired/i);
  });

  it("blocks the sender when the offer is valid", async () => {
    const offers = new PendingBlockOfferStore();
    const token = offers.create(sampleMessage({ sessionId: "42" }), "level3_messages_block", "a");
    const execute = vi.fn(async () => undefined);
    const notifications = { sendHTML: vi.fn(async () => true) };

    const useCase = new HandleOwnerBlockCallbackUseCase(
      offers,
      {
        hasPriorBlockInSession: async () => false,
        saveDeferred: vi.fn()
      } as never,
      { execute } as never,
      { getClientForBlock: async () => ({}) } as never,
      {
        assignModerationTier: () => ({
          experimentId: "level3_messages_block",
          variantId: "a",
          html: "blocked {{SESSION_USERNAME}}"
        })
      } as never,
      notifications as never,
      mockAnalytics() as never,
      mockLogger() as never
    );

    const message = await useCase.execute(42, token);
    expect(message).toMatch(/blocked/i);
    expect(execute).toHaveBeenCalledOnce();
    expect(notifications.sendHTML).toHaveBeenCalledOnce();
  });
});
