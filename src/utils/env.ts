import dotenv from "dotenv";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { z } from "zod";

const require = createRequire(import.meta.url);
const packageName: string = require("../../package.json").name;

type NodeEnv = "development" | "test" | "production";

const boolish = z
  .string()
  .optional()
  .transform((v) => {
    if (v === undefined || v.trim() === "") return true;
    const s = v.trim().toLowerCase();
    return s === "1" || s === "true" || s === "yes" || s === "on";
  });

const boolishFalse = z
  .string()
  .optional()
  .transform((v) => {
    if (v === undefined || v.trim() === "") return false;
    const s = v.trim().toLowerCase();
    return s === "1" || s === "true" || s === "yes" || s === "on";
  });

const schema = z.object({
  NODE_ENV: z
    .preprocess(
      (v) => (v === undefined || v === "" ? "development" : v),
      z.enum(["development", "test", "production"])
    ),
  DATABASE_URL: z.string().min(1),
  DATABASE_SSL: boolish,
  DATABASE_USE_IAM: boolishFalse,
  DATABASE_IAM_REGION: z.string().optional(),
  DATABASE_IAM_HOST: z.string().optional(),
  DATABASE_IAM_PORT: z.coerce.number().default(5432),
  DATABASE_IAM_USER: z.string().optional(),
  DATABASE_IAM_DBNAME: z.string().optional(),
  LOG_LEVEL: z.string().default("info"),
  PORT: z.coerce.number().default(3000),
  TELEGRAM_API_ID: z.coerce.number().finite().positive(),
  TELEGRAM_API_HASH: z.string().min(1),
  TELEGRAM_USE_WSS: boolish,
  TELEGRAM_CONNECT_TIMEOUT_MS: z.coerce.number().default(20000),
  AUTH_HOST_BASE: z.string().optional(),
  AUTH_HTTP_PORT: z.coerce.number().default(8787),
  MGMT_BOT_TOKEN: z.string().optional()
});

export type Env = z.infer<typeof schema>;

let envCache: Env | undefined;

export const env: Env = new Proxy({} as Env, {
  get(_target, prop: string | symbol) {
    if (envCache === undefined) {
      throw new Error("env not initialized — call initEnv() first");
    }
    return envCache[prop as keyof Env];
  }
});

function normalizeNodeEnv(raw: string | undefined): NodeEnv {
  const v = (raw?.trim() || "development").toLowerCase();
  if (v === "production" || v === "live" || v === "prod") return "production";
  if (v === "test" || v === "staging") return "test";
  return "development";
}

function envFileForNodeEnv(nodeEnv: NodeEnv): string {
  if (nodeEnv === "production") return ".env.production";
  if (nodeEnv === "test") return ".env.test";
  return ".env.development";
}

function vaultProjectForNodeEnv(nodeEnv: NodeEnv): string | null {
  if (nodeEnv === "production") return `live-${packageName}`;
  if (nodeEnv === "test") return `test-${packageName}`;
  return null;
}

function secretsAlreadyInjected(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim() && process.env.TELEGRAM_API_HASH?.trim());
}

async function loadFromVault(projectPath: string): Promise<void> {
  const addr = process.env.VAULT_ADDR?.replace(/\/$/, "");
  const token = process.env.VAULT_READ_TOKEN?.trim();
  if (!addr || !token) {
    throw new Error("VAULT_ADDR and VAULT_READ_TOKEN required for Vault env load");
  }

  const res = await fetch(`${addr}/v1/secret/data/${projectPath}`, {
    headers: { "X-Vault-Token": token }
  });
  if (!res.ok) {
    throw new Error(`Vault read failed for secret/${projectPath}: HTTP ${res.status}`);
  }

  const body = (await res.json()) as { data?: { data?: Record<string, string> } };
  const data = body.data?.data;
  if (!data || Object.keys(data).length === 0) {
    throw new Error(`Vault secret/${projectPath} is empty`);
  }

  for (const [key, value] of Object.entries(data)) {
    if (process.env[key] === undefined || process.env[key] === "") {
      process.env[key] = value;
    }
  }
}

function loadFromEnvFile(nodeEnv: NodeEnv): void {
  const file = resolve(envFileForNodeEnv(nodeEnv));
  if (!existsSync(file)) {
    throw new Error(
      `Missing ${envFileForNodeEnv(nodeEnv)} for NODE_ENV=${nodeEnv} — create it or set VAULT_READ_TOKEN + VAULT_ADDR`
    );
  }
  const result = dotenv.config({ path: file });
  if (result.error) {
    throw result.error;
  }
}

export async function initEnv(): Promise<Env> {
  if (envCache) return envCache;

  const nodeEnv = normalizeNodeEnv(process.env.NODE_ENV);
  process.env.NODE_ENV = nodeEnv;

  if (!secretsAlreadyInjected()) {
    const vaultToken = process.env.VAULT_READ_TOKEN?.trim();
    const vaultAddr = process.env.VAULT_ADDR?.trim();
    if (vaultToken && vaultAddr) {
      const projectPath =
        process.env.VAULT_PROJECT?.trim() || vaultProjectForNodeEnv(nodeEnv) || "";
      if (!projectPath) {
        throw new Error(
          `VAULT_READ_TOKEN set but no Vault path for NODE_ENV=${nodeEnv} — set VAULT_PROJECT or use production/test`
        );
      }
      await loadFromVault(projectPath);
    } else {
      loadFromEnvFile(nodeEnv);
    }
  }

  envCache = schema.parse(process.env);
  return envCache;
}
