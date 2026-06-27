import { describe, expect, it } from "vitest";
import { resolveBotSendContext, resolveBusinessChatId } from "./bot-context.js";
import { mockLogger } from "../test/support/mocks.js";

describe("bot-context", () => {
  it("resolves numeric chat ids for business replies", () => {
    const logger = mockLogger();
    expect(resolveBusinessChatId("12345", logger as never, "invalid")).toBe(12345);
    expect(resolveBusinessChatId("not-a-number", logger as never, "invalid")).toBeUndefined();
    expect(logger.warn).toHaveBeenCalled();
  });

  it("returns bot send context for valid user ids", () => {
    const logger = mockLogger();
    const bot = {} as never;
    expect(resolveBotSendContext(bot, "42", logger as never)).toEqual({ bot, userId: 42 });
    expect(resolveBotSendContext(undefined, "42", logger as never)).toBeUndefined();
    expect(resolveBotSendContext(bot, "bad-id", logger as never)).toBeUndefined();
  });
});
