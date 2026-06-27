import { describe, expect, it, vi } from "vitest";
import { HandlePolicyUseCase } from "./handle-policy.js";
import { mockAnalytics, mockLogger } from "../../test/support/mocks.js";

describe("HandlePolicyUseCase", () => {
  it("sends the requested policy file", async () => {
    const notifications = { sendHTMLFile: vi.fn(async () => true) };
    const analytics = mockAnalytics();
    const useCase = new HandlePolicyUseCase(
      notifications as never,
      analytics as never,
      mockLogger() as never
    );

    await useCase.execute(7, "/help");
    expect(notifications.sendHTMLFile).toHaveBeenCalledOnce();
    expect(analytics.trackEvent).toHaveBeenCalledWith("policy_sent", {
      userId: 7,
      command: "/help",
      sent: true
    });
  });

  it("ignores unknown commands", async () => {
    const notifications = { sendHTMLFile: vi.fn(async () => true) };
    const useCase = new HandlePolicyUseCase(
      notifications as never,
      mockAnalytics() as never,
      mockLogger() as never
    );

    await useCase.execute(7, "/unknown");
    expect(notifications.sendHTMLFile).not.toHaveBeenCalled();
  });

  it("logs when policy delivery fails", async () => {
    const notifications = { sendHTMLFile: vi.fn(async () => false) };
    const logger = mockLogger();
    const useCase = new HandlePolicyUseCase(
      notifications as never,
      mockAnalytics() as never,
      logger as never
    );

    await useCase.execute(7, "/terms");
    expect(logger.warn).toHaveBeenCalledWith("policy_send_failed", expect.any(Object));
  });
});
