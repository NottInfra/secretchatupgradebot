import { beforeEach, describe, expect, it, vi } from "vitest";
import { connectOwnerTdlib } from "./owner-tdlib-connect.js";
import { mockLogger } from "../test/support/mocks.js";

const tdlibClient = {
  login: vi.fn(async () => undefined),
  close: vi.fn(async () => undefined)
};

vi.mock("../lib/telegram/tdlib-client.js", () => ({
  createTdlibClient: vi.fn(() => tdlibClient)
}));

vi.mock("../lib/telegram/session-files.js", () => ({
  materializeSessionFiles: vi.fn(() => ({
    databaseDirectory: "/tmp/db",
    filesDirectory: "/tmp/files"
  }))
}));

describe("connectOwnerTdlib", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tdlibClient.login.mockResolvedValue(undefined);
  });

  it("returns client when TDLib login succeeds", async () => {
    const client = await connectOwnerTdlib(
      { accountId: "acc-1", sessionPath: "accounts/acc-1", name: "svc", files: {} },
      { apiId: 1, apiHash: "hash" },
      mockLogger() as never
    );
    expect(client).toBe(tdlibClient);
    expect(tdlibClient.login).toHaveBeenCalledOnce();
  });

  it("returns undefined and closes client when login fails", async () => {
    tdlibClient.login.mockRejectedValueOnce(new Error("session_not_authorized"));
    const client = await connectOwnerTdlib(
      { accountId: "acc-1", sessionPath: "accounts/acc-1", name: "svc" },
      { apiId: 1, apiHash: "hash" },
      mockLogger() as never
    );
    expect(client).toBeUndefined();
    expect(tdlibClient.close).toHaveBeenCalledOnce();
  });
});
