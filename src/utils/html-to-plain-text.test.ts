import { describe, expect, it } from "vitest";
import { htmlToPlainText } from "./html-to-plain-text.js";

describe("htmlToPlainText", () => {
  it("normalizes Windows line endings", () => {
    expect(htmlToPlainText("a\r\nb")).toBe("a\nb");
  });

  it("converts links to label plus URL", () => {
    expect(htmlToPlainText('<a href="https://x.test">Click</a>')).toBe("Click (https://x.test)");
  });

  it("strips tags and decodes entities", () => {
    expect(htmlToPlainText("<p>Hi&nbsp;&amp; <b>there</b></p>")).toBe("Hi & there");
  });

  it("formats list items and collapses blank lines", () => {
    expect(htmlToPlainText("<ul><li>one</li><li>two</li></ul>\n\n\n")).toBe("- one\n- two");
  });
});
