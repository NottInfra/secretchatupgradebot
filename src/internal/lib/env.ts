import dotenv from "dotenv";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { envSchema, type Env, type NodeEnv } from "./env-schema.js";
import {
  loadSecretsFromVault,
  secretsAlreadyInjected,
  vaultProjectForNodeEnv
} from "./env-vault.js";

const require = createRequire(import.meta.url);
const packageName: string = require("../../../package.json").name;

let envCache: Env | undefined;

export type { Env };

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

function mergeEnvFile(nodeEnv: NodeEnv): void {
  const file = resolve(envFileForNodeEnv(nodeEnv));
  if (!existsSync(file)) return;
  dotenv.config({ path: file });
}

async function loadSecrets(nodeEnv: NodeEnv): Promise<void> {
  if (secretsAlreadyInjected()) return;

  const vaultToken = process.env.VAULT_READ_TOKEN?.trim();
  const vaultAddr = process.env.VAULT_ADDR?.trim();
  if (vaultToken && vaultAddr) {
    const projectPath = process.env.VAULT_PROJECT?.trim() || vaultProjectForNodeEnv(nodeEnv, packageName) || "";
    if (!projectPath) {
      throw new Error(
        `VAULT_READ_TOKEN set but no Vault path for NODE_ENV=${nodeEnv} — set VAULT_PROJECT or use production/test`
      );
    }
    await loadSecretsFromVault(projectPath);
    return;
  }

  loadFromEnvFile(nodeEnv);
}

export async function initEnv(): Promise<Env> {
  if (envCache) return envCache;

  const nodeEnv = normalizeNodeEnv(process.env.NODE_ENV);
  process.env.NODE_ENV = nodeEnv;
  mergeEnvFile(nodeEnv);
  await loadSecrets(nodeEnv);

  envCache = envSchema.parse(process.env);
  return envCache;
}
