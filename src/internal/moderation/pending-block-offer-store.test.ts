import { describe, expect, it } from "vitest";
import { PendingBlockOfferStore } from "./pending-block-offer-store.js";
import { sampleMessage } from "../test/support/mocks.js";

describe("PendingBlockOfferStore", () => {
  it("creates and consumes offers for the matching owner", () => {
    const store = new PendingBlockOfferStore();
    const token = store.create(sampleMessage(), 1, "exp-1", "var-a");
    const offer = store.consume(token, "owner-1");
    expect(offer).toMatchObject({
      senderId: "sender-1",
      experimentId: "exp-1",
      variantId: "var-a"
    });
    expect(store.consume(token, "owner-1")).toBeUndefined();
  });

  it("rejects consumption for a different owner", () => {
    const store = new PendingBlockOfferStore();
    const token = store.create(sampleMessage(), 1, "exp-1", "var-a");
    expect(store.consume(token, "other-owner")).toBeUndefined();
  });
});
