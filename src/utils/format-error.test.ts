import { describe, expect, it } from "vitest";
import { formatError } from "./format-error.js";

describe("formatError", () => {
  it("stringifies non-error values", () => {
    expect(formatError("oops")).toBe("oops");
  });

  it("formats plain errors", () => {
    expect(formatError(new Error("boom"))).toBe("boom");
  });

  it("includes error causes", () => {
    const err = new Error("outer");
    err.cause = new Error("inner");
    expect(formatError(err)).toBe("outer cause=inner");
  });

  it("formats aggregate errors with nested messages", () => {
    const err = new AggregateError([new Error("a"), new Error("b")], "failed");
    expect(formatError(err)).toBe("failed: a; b");
  });

  it("returns aggregate message when there are no nested errors", () => {
    expect(formatError(new AggregateError([], "empty"))).toBe("empty");
  });
});
