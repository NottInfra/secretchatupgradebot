import { describe, expect, it, vi } from "vitest";
import { SessionRepository } from "./session-repository.js";

describe("SessionRepository", () => {
  it("upserts and reads sessions by user id", async () => {
    const write = vi.fn(async () => undefined);
    const read = vi.fn(async () => ({ userId: "7", sessionString: "s", active: true }));
    const repo = new SessionRepository({ write, read } as never);

    await repo.upsertActive("7", "session");
    await expect(repo.findByUserId("7")).resolves.toEqual({
      userId: "7",
      sessionString: "s",
      active: true
    });
    expect(write).toHaveBeenCalledWith("sessions.upsert_active", "7", "session", expect.any(String));
  });
});
