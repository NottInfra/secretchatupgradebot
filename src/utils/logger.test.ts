import { describe, expect, it, vi } from "vitest";

vi.mock("./env.js", () => ({
  env: { LOG_LEVEL: "warn" }
}));

import { Logger } from "./logger.js";

describe("Logger", () => {
  it("respects the configured minimum log level", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const logger = new Logger();

    logger.info("hidden");
    logger.warn("visible");

    expect(logSpy).toHaveBeenCalledOnce();
    expect(logSpy.mock.calls[0]?.[0]).toContain("visible");
    logSpy.mockRestore();
  });
});
