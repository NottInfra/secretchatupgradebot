import { describe, expect, it, vi } from "vitest";
import { withErrorBoundary } from "./error-middleware.js";

describe("withErrorBoundary", () => {
  it("runs the wrapped handler", async () => {
    const handler = vi.fn(async () => undefined);
    await withErrorBoundary(handler)();
    expect(handler).toHaveBeenCalledOnce();
  });

  it("swallows handler errors", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const handler = vi.fn(async () => {
      throw new Error("boom");
    });

    await expect(withErrorBoundary(handler)()).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
