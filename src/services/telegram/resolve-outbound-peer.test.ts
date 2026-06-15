import { describe, expect, it, vi } from "vitest";
import { Api } from "telegram";
import { resolveOutboundPeer } from "./resolve-outbound-peer.js";
import { sampleMessage } from "../../test/support/mocks.js";

describe("resolveOutboundPeer", () => {
  it("uses saved messages self peer when sender and chat match the session", async () => {
    const client = {
      getInputEntity: vi.fn(async (peer: unknown) => peer)
    };

    const peer = await resolveOutboundPeer(
      client as never,
      sampleMessage({
        sessionId: "100",
        chatId: "100",
        senderId: "100"
      })
    );

    expect(peer).toBe("me");
  });

  it("falls back to InputPeerSelf when saved messages lookup fails", async () => {
    const client = {
      getInputEntity: vi.fn(async (peer: unknown) => {
        if (peer === "me") throw new Error("offline");
        return peer;
      })
    };

    const peer = await resolveOutboundPeer(
      client as never,
      sampleMessage({
        sessionId: "100",
        chatId: "100",
        senderId: "100"
      })
    );

    expect(peer).toBeInstanceOf(Api.InputPeerSelf);
  });

  it("resolves by username when available", async () => {
    const client = {
      getInputEntity: vi.fn(async (peer: unknown) => peer),
      getDialogs: vi.fn()
    };

    const peer = await resolveOutboundPeer(
      client as never,
      sampleMessage({ senderUsername: "@alice" })
    );

    expect(peer).toBe("alice");
  });
});
