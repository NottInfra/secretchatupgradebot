import { existsSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import * as tdl from "tdl";
import type { Logger } from "../../utils/logger.js";

const require = createRequire(import.meta.url);

export type TdlibClient = ReturnType<typeof tdl.createClient>;

type CreateTdlibClientParams = {
  sessionPath: string;
  sessionProviderRoot?: string;
  apiId: number;
  apiHash: string;
  logger: Logger;
};

let tdlibConfigured = false;

function configureTdlib(): void {
  if (tdlibConfigured) return;

  const explicit = process.env.TDLIB_JSON_PATH?.trim();
  if (explicit) {
    tdl.configure({ tdjson: explicit });
    tdlibConfigured = true;
    return;
  }

  try {
    const { getTdjson } = require("prebuilt-tdlib") as { getTdjson: () => string };
    tdl.configure({ tdjson: getTdjson() });
    tdlibConfigured = true;
    return;
  } catch {
    // fall through to system paths
  }

  const candidates = [
    "/opt/homebrew/lib/libtdjson.dylib",
    "/opt/homebrew/opt/tdlib/lib/libtdjson.dylib",
    "/usr/local/lib/libtdjson.dylib"
  ];
  for (const path of candidates) {
    if (existsSync(path)) {
      tdl.configure({ tdjson: path });
      tdlibConfigured = true;
      return;
    }
  }

  throw new Error(
    "TDLib not found — install prebuilt-tdlib, run `brew install tdlib`, or set TDLIB_JSON_PATH"
  );
}

function resolveSessionRoot(sessionPath: string, sessionProviderRoot?: string): string {
  const trimmed = sessionPath.trim();
  if (!trimmed) throw new Error("session_path_empty");
  if (existsSync(trimmed) || trimmed.startsWith("/")) {
    return resolve(trimmed);
  }
  if (sessionProviderRoot?.trim()) {
    return resolve(sessionProviderRoot.trim(), trimmed);
  }
  return resolve(trimmed);
}

function sessionDirsFor(sessionPath: string, sessionProviderRoot?: string): { databaseDirectory: string; filesDirectory: string } {
  const root = resolveSessionRoot(sessionPath, sessionProviderRoot);
  const databaseDirectory = join(root, "tdlib-db");
  const filesDirectory = join(root, "tdlib-files");
  mkdirSync(databaseDirectory, { recursive: true });
  mkdirSync(filesDirectory, { recursive: true });
  return { databaseDirectory, filesDirectory };
}

export function createTdlibClient(params: CreateTdlibClientParams): TdlibClient {
  configureTdlib();
  const { databaseDirectory, filesDirectory } = sessionDirsFor(
    params.sessionPath,
    params.sessionProviderRoot
  );
  const client = tdl.createClient({
    apiId: params.apiId,
    apiHash: params.apiHash,
    databaseDirectory,
    filesDirectory
  });
  client.on("error", (error: Error) => {
    params.logger.error("tdlib_client_error", {
      sessionPath: params.sessionPath,
      error: String(error)
    });
  });
  return client;
}
