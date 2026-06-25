import { describe, expect, it, vi } from "vitest";
import { SessionRepository } from "./session-repository.js";

describe("SessionRepository", () => {
  it("ensures and reads svc users by user id", async () => {
    const write = vi.fn(async () => undefined);
    const read = vi.fn(async () => ({ userId: "7", active: true }));
    const repo = new SessionRepository({ write, read } as never);

    await repo.ensureUser("7");
    await repo.setActive("7", true);

    expect(await repo.findByUserId("7")).toEqual({
      userId: "7",
      active: true
    });
    expect(write).toHaveBeenCalledWith("svc_users.ensure_user", "7", expect.any(String));
    expect(write).toHaveBeenCalledWith("svc_users.set_active", "7", true, expect.any(String));
  });
});
