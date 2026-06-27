import { describe, expect, it, vi } from "vitest";
import { Analytics } from "./analytics.js";

vi.mock("./telemetry.js", () => ({
  recordAnalyticsEvent: vi.fn()
}));

describe("Analytics", () => {
  it("forwards events to telemetry", async () => {
    const { recordAnalyticsEvent } = await import("./telemetry.js");
    const analytics = new Analytics();
    analytics.trackEvent("test_event", { ok: true });
    expect(recordAnalyticsEvent).toHaveBeenCalledWith("test_event", { ok: true });
  });
});
