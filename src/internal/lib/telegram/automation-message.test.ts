import { describe, expect, it, vi } from "vitest";
import {
  extractAutomationMessage,
  resolveBusinessConnectionOwner
} from "./automation-message.js";

describe("extractAutomationMessage", () => {
  it("reads business_message updates with a connection id", () => {
    const message = {
      business_connection_id: "bc-1",
      message_id: 1,
      chat: { id: 10 },
      from: { id: 20 }
    };
    expect(extractAutomationMessage({ business_message: message })).toEqual(message);
  });

  it("reads legacy message updates with a connection id", () => {
    const message = {
      business_connection_id: "bc-2",
      message_id: 2,
      chat: { id: 11 },
      from: { id: 21 }
    };
    expect(extractAutomationMessage({ message })).toEqual(message);
  });

  it("returns undefined when no business connection is present", () => {
    expect(extractAutomationMessage({ message: { message_id: 1, chat: { id: 1 } } })).toBeUndefined();
  });
});

describe("resolveBusinessConnectionOwner", () => {
  it("maps telegram user id and username", async () => {
    const callApi = vi.fn(async () => ({ user: { id: 99, username: "owner" } }));
    await expect(resolveBusinessConnectionOwner({ callApi }, "bc-1")).resolves.toEqual({
      ownerUserId: "99",
      sessionOwnerUsername: "owner"
    });
  });

  it("returns undefined when user id is missing", async () => {
    const callApi = vi.fn(async () => ({ user: {} }));
    await expect(resolveBusinessConnectionOwner({ callApi }, "bc-1")).resolves.toBeUndefined();
  });
});
