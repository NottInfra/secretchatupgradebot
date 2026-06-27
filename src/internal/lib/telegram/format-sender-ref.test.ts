import { describe, expect, it } from "vitest";
import { formatSenderRefHtml } from "./format-sender-ref.js";

describe("formatSenderRefHtml", () => {
  it("links by username when present", () => {
    expect(formatSenderRefHtml("123", "@alice")).toBe(
      '<a href="tg://resolve?domain=alice">@alice</a>'
    );
  });

  it("escapes unsafe username characters", () => {
    expect(formatSenderRefHtml("123", '<bad"user>')).toBe(
      '<a href="tg://resolve?domain=&lt;bad&quot;user&gt;">@&lt;bad&quot;user&gt;</a>'
    );
  });

  it("falls back to user id link", () => {
    expect(formatSenderRefHtml("999")).toBe('<a href="tg://user?id=999">User ID 999</a>');
  });
});
