import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { Session } from "@sessionprovider/sdk";

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

/** Write sessionprovider `files` payload to local disk for TDLib (remote consumer containers). */
export function materializeSessionFiles(
  session: { sessionPath: string; sessionDirs?: Session["sessionDirs"]; files?: Session["files"] },
  sessionProviderRoot?: string
): { databaseDirectory: string; filesDirectory: string } {
  const root = resolveSessionRoot(session.sessionPath, sessionProviderRoot);
  const databaseDirectory = session.sessionDirs?.databaseDirectory
    ? resolveSessionRoot(session.sessionDirs.databaseDirectory, sessionProviderRoot)
    : join(root, "tdlib-db");
  const filesDirectory = session.sessionDirs?.filesDirectory
    ? resolveSessionRoot(session.sessionDirs.filesDirectory, sessionProviderRoot)
    : join(root, "tdlib-files");

  mkdirSync(databaseDirectory, { recursive: true });
  mkdirSync(filesDirectory, { recursive: true });

  if (session.files) {
    for (const [relPath, b64] of Object.entries(session.files)) {
      const dest = join(root, relPath);
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, Buffer.from(b64, "base64"));
    }
  }

  return { databaseDirectory, filesDirectory };
}
