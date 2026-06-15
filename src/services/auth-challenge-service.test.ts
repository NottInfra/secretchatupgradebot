import { describe, expect, it } from "vitest";
import { AuthChallengeService } from "./auth-challenge-service.js";

describe("AuthChallengeService", () => {
  it("returns prompt for a live challenge", () => {
    const service = new AuthChallengeService();
    const { token } = service.create(1, "Enter code");
    expect(service.getPrompt(token)).toBe("Enter code");
  });

  it("resolves submitted values", async () => {
    const service = new AuthChallengeService();
    const { token, wait } = service.create(1, "Enter code");
    const result = service.submit(token, " 12345 ");
    expect(result).toEqual({ ok: true });
    await expect(wait).resolves.toBe("12345");
  });

  it("rejects unknown tokens", () => {
    const service = new AuthChallengeService();
    expect(service.submit("missing", "x")).toEqual({ ok: false, reason: "not_found_or_expired" });
  });
});
