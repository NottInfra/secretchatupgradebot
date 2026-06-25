import { beforeEach, describe, expect, it, vi } from "vitest";

const mockQuery = vi.fn();
const mockClose = vi.fn(async () => undefined);

vi.mock("./database.js", () => ({
  Database: class MockDatabase {
    query = mockQuery;
    close = mockClose;
  }
}));

import { Store } from "./root.js";

describe("Store", () => {
  let store: Store;

  beforeEach(() => {
    mockQuery.mockReset();
    mockClose.mockClear();
    store = new Store();
  });

  it("inserts incoming messages and returns the new id", async () => {
    mockQuery.mockResolvedValueOnce([{ id: "42" }]);

    await expect(
      store.write("incoming_messages.insert", "sender-1", "owner-1", "2026-06-25T00:00:00.000Z")
    ).resolves.toBe(42);

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO incoming_messages"),
      ["sender-1", "owner-1", "2026-06-25T00:00:00.000Z"]
    );
  });

  it("persists action logs with mapped decision values", async () => {
    mockQuery.mockResolvedValueOnce([]);

    await store.write(
      "action_logs.insert",
      7,
      { action: "allow", confidence: 1, reason: "message_warning_sent" },
      "2026-06-25T00:00:00.000Z"
    );

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO action_logs"),
      [7, "warn", "2026-06-25T00:00:00.000Z"]
    );
  });

  it("maps block and ignore decisions for action logs", async () => {
    mockQuery.mockResolvedValue([]);

    await store.write(
      "action_logs.insert",
      1,
      { action: "block", confidence: 1, reason: "blocked" },
      "2026-06-25T00:00:00.000Z"
    );
    await store.write(
      "action_logs.insert",
      2,
      { action: "ignore", confidence: 1, reason: "ignored" },
      "2026-06-25T00:00:00.000Z"
    );

    expect(mockQuery).toHaveBeenNthCalledWith(1, expect.any(String), [1, "block", expect.any(String)]);
    expect(mockQuery).toHaveBeenNthCalledWith(2, expect.any(String), [2, "ignore", expect.any(String)]);
  });

  it("writes deferred action logs without blocking", async () => {
    mockQuery.mockResolvedValueOnce([]);

    store.writeDeferred(
      "action_logs.insert",
      9,
      { action: "block", confidence: 1, reason: "blocked" },
      "2026-06-25T00:00:00.000Z"
    );

    await vi.waitFor(() => {
      expect(mockQuery).toHaveBeenCalledOnce();
    });
  });

  it("ensures and activates svc users while caching session reads", async () => {
    mockQuery.mockResolvedValue([]);

    await store.write("svc_users.ensure_user", "owner-1", "2026-06-25T00:00:00.000Z");
    await store.write("svc_users.set_active", "owner-1", true, "2026-06-25T00:00:00.000Z");

    await expect(store.read("svc_users.find_by_user_id", 0, "owner-1")).resolves.toEqual({
      userId: "owner-1",
      active: true
    });
    expect(mockQuery).not.toHaveBeenCalledWith(
      expect.stringContaining("SELECT user_id, active FROM svc_users"),
      expect.any(Array)
    );
  });

  it("activates svc users when set_active runs before ensure_user", async () => {
    mockQuery.mockResolvedValueOnce([]);

    await store.write("svc_users.set_active", "owner-3", true, "2026-06-25T00:00:00.000Z");

    await expect(store.read("svc_users.find_by_user_id", 0, "owner-3")).resolves.toEqual({
      userId: "owner-3",
      active: true
    });
  });

  it("loads svc users from the database when not cached", async () => {
    mockQuery.mockResolvedValueOnce([{ user_id: "owner-2", active: false }]);

    await expect(store.read("svc_users.find_by_user_id", 0, "owner-2")).resolves.toEqual({
      userId: "owner-2",
      active: false
    });

    await expect(store.read("svc_users.find_by_user_id", 0, "owner-2")).resolves.toEqual({
      userId: "owner-2",
      active: false
    });
    expect(mockQuery).toHaveBeenCalledOnce();
  });

  it("returns null when a svc user is missing", async () => {
    mockQuery.mockResolvedValueOnce([]);

    await expect(store.read("svc_users.find_by_user_id", 0, "missing")).resolves.toBeNull();
  });

  it("lists active svc users and reuses the snapshot", async () => {
    mockQuery.mockResolvedValueOnce([
      { user_id: "1", active: true },
      { user_id: "2", active: true }
    ]);

    await expect(store.read("svc_users.list_active", 3000)).resolves.toEqual([
      { userId: "1", active: true },
      { userId: "2", active: true }
    ]);
    await expect(store.read("svc_users.list_active", 3000)).resolves.toEqual([
      { userId: "1", active: true },
      { userId: "2", active: true }
    ]);
    expect(mockQuery).toHaveBeenCalledOnce();
  });

  it("counts incoming messages by sender and receiver", async () => {
    mockQuery.mockResolvedValueOnce([{ n: "3" }]);

    await expect(
      store.read("incoming_messages.count_by_sender", 0, "sender-1", "owner-1")
    ).resolves.toBe(3);
  });

  it("counts incoming messages with a collapse window", async () => {
    mockQuery.mockResolvedValueOnce([{ n: "2" }]);

    await expect(
      store.read("incoming_messages.count_by_sender", 0, "sender-1", "owner-1", 30)
    ).resolves.toBe(2);

    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining("make_interval"), [
      "sender-1",
      "owner-1",
      30
    ]);
  });

  it("counts messages in a time window", async () => {
    mockQuery.mockResolvedValueOnce([{ n: "1" }]);

    await expect(
      store.read(
        "incoming_messages.count_in_instance",
        0,
        "sender-1",
        "2026-06-25T00:00:00.000Z",
        60
      )
    ).resolves.toBe(1);
  });

  it("checks prior blocks in the same session and on other accounts", async () => {
    mockQuery
      .mockResolvedValueOnce([{ exists: true }])
      .mockResolvedValueOnce([{ exists: false }]);

    await expect(
      store.read("action_logs.has_prior_block_in_session", 0, "sender-1", "owner-1")
    ).resolves.toBe(true);
    await expect(
      store.read("action_logs.has_prior_block_by_other_session", 0, "sender-1", "owner-1")
    ).resolves.toBe(false);
  });

  it("caches generic read queries for the requested lifetime", async () => {
    mockQuery.mockResolvedValueOnce([{ n: "5" }]);

    await expect(
      store.read("incoming_messages.count_by_sender", 1000, "sender-1", "owner-1")
    ).resolves.toBe(5);
    await expect(
      store.read("incoming_messages.count_by_sender", 1000, "sender-1", "owner-1")
    ).resolves.toBe(5);

    expect(mockQuery).toHaveBeenCalledOnce();
  });

  it("upserts telegram users", async () => {
    mockQuery.mockResolvedValueOnce([]);

    await store.write("users.upsert", 123, "alice", "Alice", "A", "2026-06-25T00:00:00.000Z");

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO users"),
      [123, "alice", "Alice", "A", "2026-06-25T00:00:00.000Z"]
    );
  });

  it("closes the backing database", async () => {
    await store.close();
    expect(mockClose).toHaveBeenCalledOnce();
  });

  it("rejects unknown read queries", async () => {
    await expect(store.read("missing.read", 0)).rejects.toThrow(/unknown read query/);
  });
});
