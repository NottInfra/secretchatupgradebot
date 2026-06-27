import { z } from "zod";

const boolish = z
  .string()
  .optional()
  .transform((v) => {
    if (v === undefined || v.trim() === "") return true;
    const s = v.trim().toLowerCase();
    return s === "1" || s === "true" || s === "yes" || s === "on";
  });

export const envSchema = z.object({
  NODE_ENV: z
    .preprocess(
      (v) => (v === undefined || v === "" ? "development" : v),
      z.enum(["development", "test", "production"])
    ),
  DATABASE_URL: z.string().min(1),
  DATABASE_SSL: boolish,
  LOG_LEVEL: z.string().default("info"),
  PORT: z.coerce.number().default(3000),
  TELEGRAM_API_ID: z.coerce.number().finite().positive(),
  TELEGRAM_API_HASH: z.string().min(1),
  SESSION_PROVIDER_URL: z.string().default("ws://localhost:3000"),
  SESSION_PROVIDER_USER_ID: z.string().min(1),
  SESSION_PROVIDER_API_KEY: z.string().min(1),
  SESSION_PROVIDER_SVC_NAME: z.string().min(1),
  SESSION_PROVIDER_ROOT: z.string().optional(),
  MGMT_BOT_TOKEN: z.string().optional(),
  MESSAGE_INSTANCE_COLLAPSE_SECONDS: z.coerce.number().int().nonnegative()
});

export type Env = z.infer<typeof envSchema>;

export type NodeEnv = Env["NODE_ENV"];
