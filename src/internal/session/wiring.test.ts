import { describe, expect, it, vi } from "vitest";
import { createSessionStack } from "./wiring.js";

vi.mock("./owner-session-service.js", () => ({
  OwnerSessionService: {
    create: vi.fn(() => ({ start: vi.fn(async () => undefined) }))
  }
}));

vi.mock("./block-onboarding-coordinator.js", () => ({
  BlockOnboardingCoordinator: vi.fn(function MockCoordinator() {
    return { executeBlockWithSession: vi.fn() };
  })
}));

describe("createSessionStack", () => {
  it("starts owner sessions and returns coordinators", async () => {
    const stack = await createSessionStack(
      {
        SESSION_PROVIDER_USER_ID: "u",
        SESSION_PROVIDER_API_KEY: "k",
        SESSION_PROVIDER_URL: "http://x",
        SESSION_PROVIDER_SVC_NAME: "svc",
        SESSION_PROVIDER_ROOT: "/tmp",
        TELEGRAM_API_ID: 1,
        TELEGRAM_API_HASH: "h",
        MGMT_BOT_TOKEN: "t",
        MESSAGE_INSTANCE_COLLAPSE_SECONDS: 60,
        NODE_ENV: "test"
      } as never,
      {} as never,
      { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never,
      {} as never
    );
    expect(stack.ownerSessions).toBeDefined();
    expect(stack.blockOnboarding).toBeDefined();
  });
});
