import { describe, expect, it } from "vitest";
import { envSchema } from "./env-schema.js";

describe("envSchema", () => {
  it("parses required bot env keys", () => {
    const parsed = envSchema.parse({
      NODE_ENV: "test",
      DATABASE_URL: "postgres://local/test",
      MGMT_BOT_TOKEN: "token",
      SESSION_PROVIDER_USER_ID: "u",
      SESSION_PROVIDER_API_KEY: "k",
      SESSION_PROVIDER_URL: "http://localhost",
      SESSION_PROVIDER_SVC_NAME: "svc",
      TELEGRAM_API_ID: "1",
      TELEGRAM_API_HASH: "hash",
      MESSAGE_INSTANCE_COLLAPSE_SECONDS: "60"
    });
    expect(parsed.MESSAGE_INSTANCE_COLLAPSE_SECONDS).toBe(60);
  });
});
