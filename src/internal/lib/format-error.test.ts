import { describe, expect, it } from "vitest";
import { formatError } from "./format-error.js";

describe("formatError", () => {
  it("stringifies errors and unknown values", () => {
    expect(formatError(new Error("boom"))).toContain("boom");
    expect(formatError("plain")).toBe("plain");
  });
});
